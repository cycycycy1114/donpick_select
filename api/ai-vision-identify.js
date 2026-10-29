import { GoogleGenAI } from '@google/genai';

// 確保自動抓取環境變數中的 GEMINI_API_KEY
const ai = new GoogleGenAI({});

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
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '缺少圖片資料' });
    }

    // 呼叫 Gemini 2.5 Flash 模型進行圖片辨識
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            data: imageBase64,
            mimeType: mimeType || 'image/jpeg'
          }
        },
        {
          text: '請幫我辨識這張照片中的所有商品與價格。請務必只回傳純 JSON 格式（絕對不要包含任何 markdown 標記如 ```json，也不要有多餘的前後文字）：{"items": [{"productName": "商品名稱或編號", "price": 數字價格},]}'
        }
      ]
    });

    // 取得 AI 回傳的文字內容
    let text = '';
    if (typeof response.text === 'function') {
      text = response.text();
    } else if (response.text) {
      text = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = response.candidates[0].content.parts[0].text;
    }

    text = text.trim();
    console.log("AI 原始回應:", text);

    // 清除可能殘留的 markdown 標記
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error("JSON 解析失敗，原始文字為:", text);
      return res.status(500).json({ success: false, error: 'AI 回傳格式錯誤，請再試一次' });
    }

    return res.status(200).json({ success: true, ...data });

  } catch (error) {
    console.error("AI Vision Server Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}