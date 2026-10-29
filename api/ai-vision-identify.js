import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI();

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
    // 💡 改為直接接收 Base64 與 mimeType
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '缺少圖片資料' });
    }

    // 呼叫 Gemini Vision 模型進行圖片辨識（支援多筆商品清單）
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
          text: '請幫我辨識這張照片中的所有商品與價格。請回傳一個 JSON 格式（不要有 markdown 程式碼區塊標記，直接回傳純 JSON 陣列）：{"items": [{"productName": "商品名稱或編號", "price": 數字價格}, ...]}'
        }
      ]
    });

    let text = response.text.trim();
    text = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    
    const data = JSON.parse(text);
    return res.status(200).json({ success: true, ...data });

  } catch (error) {
    console.error("AI Vision Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}