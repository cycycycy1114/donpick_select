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
      return res.status(500).json({ success: false, error: '後端未設定 GEMINI_API_KEY 環境變數' });
    }

    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '缺少圖片資料' });
    }

    let cleanBase64 = imageBase64;
    if (imageBase64.includes('base64,')) {
      cleanBase64 = imageBase64.split('base64,')[1];
    }

    // 💡 使用官方指定的最新 gemini-3.8-flash 模型
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
                  data: cleanBase64
                }
              },
              {
                text: `請幫我辨識這張照片中的所有商品與價格。
規則：
1. 請依照順序（例如從左到右、從上到下）為每個商品依序編號：A、B、C、D...。
2. 品名部分請維持簡單的「代號-商品簡稱」（例如：A-托特包、B-御守），讓代號清楚對應照片中的位置。
3. 請仔細對應其價格，找不到價格請填 0。
4. 請務必只回傳純 JSON 格式，結構必須嚴格為：{"items": [{"productName": "A-商品名", "price": 數字價格}]}`
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

    // 清除可能殘留的 Markdown 標記
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      // 💡 防呆機制：若 AI 多話，自動用正規表達式把 JSON 抓出來
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          data = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error('AI 回傳格式解析失敗');
        }
      } else {
        throw new Error('AI 未能回傳有效的商品清單');
      }
    }

    return res.status(200).json({ success: true, items: data.items || [] });

  } catch (error) {
    console.error("AI Vision Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}