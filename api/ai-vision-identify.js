export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("❌ 錯誤: 伺服器未設定 GEMINI_API_KEY");
      return res.status(500).json({ success: false, error: '後端未設定 GEMINI_API_KEY 環境變數' });
    }

    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '缺少圖片資料' });
    }

    // 💡 將模型名稱更新為官方最新的 gemini-3.8-flash
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const apiResponse = await fetch(apiUrl, {
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
                text: '請幫我辨識這張照片中的所有商品與價格。請務必只回傳純 JSON 格式（絕對不要包含任何 markdown 標記如 ```json，也不要有多餘的前後文字）：{"items": [{"productName": "商品名稱或編號", "price": 數字價格}]}'
              }
            ]
          }
        ]
      })
    });

    const result = await apiResponse.json();
    
    if (!apiResponse.ok) {
      console.error("❌ Gemini API 錯誤回應:", JSON.stringify(result));
      throw new Error(result.error?.message || 'Gemini API 呼叫失敗');
    }

    const candidate = result.candidates?.[0];
    let text = candidate?.content?.parts?.[0]?.text || '';
    
    text = text.trim();
    console.log("✨ AI 原始回應文字:", text);

    // 清除可能殘留的 markdown 標記
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