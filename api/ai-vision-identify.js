export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

async function callGemini(apiKey, modelName, imageBase64, mimeType) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetch(apiUrl, {
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
  });

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

    // 💡 智慧多模型備份清單：依序嘗試最新的 Flash 模型，確保 99.9% 辨識成功率！
    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];
    let result = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`⏳ 正在嘗試使用 AI 模型: ${modelName}`);
        result = await callGemini(apiKey, modelName, imageBase64, mimeType);
        break; // 成功就跳出迴圈
      } catch (err) {
        console.warn(`⚠️ 模型 ${modelName} 呼叫失敗:`, err.message);
        lastError = err;
      }
    }

    if (!result) {
      throw lastError || new Error('所有 AI 模型目前皆繁忙中，請稍後再試');
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