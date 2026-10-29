export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
  maxDuration: 60,
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    let apiResponse;
    let result;
    let retries = 3; // 最多自動重試 3 次

    // 💡 加上自動重試迴圈，應對伺服器短暫 high demand 塞車
    while (retries > 0) {
      apiResponse = await fetch(apiUrl, {
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
2. 品名部分請維持簡單的「代號-商品簡稱」（例如：A-托特包、B-御守）。
3. 請仔細對應其價格，找不到價格請填 0。
4. 請務必只回傳純 JSON 格式，結構必須嚴格為：{"items": [{"productName": "A-商品名", "price": 數字價格}]}`
                }
              ]
            }
          ]
        })
      });

      result = await apiResponse.json();

      if (apiResponse.ok) {
        break; // 成功就跳出迴圈
      }

      // 如果遇到流量過高，等待 2 秒後重試
      if (result.error?.message?.includes('high demand') || apiResponse.status === 429) {
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      } else {
        break; // 其他錯誤直接跳出
      }
    }
    
    if (!apiResponse.ok) {
      console.error("❌ Gemini API 錯誤回應:", JSON.stringify(result));
      throw new Error(result.error?.message || 'Gemini API 呼叫失敗');
    }

    const candidate = result.candidates?.[0];
    let text = candidate?.content?.parts?.[0]?.text || '';
    
    text = text.trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
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
    console.error("AI Vision Server Error 完整例外:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}