export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

// 支援逾時保護的 fetch 函式（避免 ECONNRESET 卡死）
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function callGemini(apiKey, modelName, imageBase64, mimeType) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mimeType || 'image/jpeg',
                data: imageBase64
              }
            },
            {
              text: '請幫我辨識這張照片中的所有商品與價格。請為每個商品加上編號或代號（例如 A-商品名稱、B-商品名稱）。請務必只回傳純 JSON 格式（絕對不要包含任何 markdown 標記如 ```json，也不要有多餘的前後文字）：{"items": [{"productName": "A-商品名稱或編號", "price": 數字價格}]}'
            }
          ]
        }
      ]
    })
  }, 15000); // 15 秒逾時

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || `Model ${modelName} failed`);
  }
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: '後端未設定 GEMINI_API_KEY 環境變數' });
    }

    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '缺少圖片資料' });
    }

    const modelsToTry = ['gemini-3.8-flash', 'gemini-2.0-flash'];
    let result = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`⏳ 正在嘗試使用模型: ${modelName}`);
        result = await callGemini(apiKey, modelName, imageBase64, mimeType);
        break;
      } catch (err) {
        console.warn(`⚠️ 模型 ${modelName} 呼叫失敗:`, err.message);
        lastError = err;
      }
    }

    if (!result) {
      throw lastError || new Error('連線逾時或 AI 伺服器忙碌中，請重新嘗試');
    }

    const candidate = result.candidates?.[0];
    let text = candidate?.content?.parts?.[0]?.text || '';
    
    text = text.trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error("❌ JSON 解析失敗，AI 原始文字為:", text);
      return res.status(500).json({ success: false, error: 'AI 回傳格式錯誤，請再試一次' });
    }

    return res.status(200).json({ success: true, ...data });

  } catch (error) {
    console.error("❌ AI Vision Server Error 完整例外:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}