import fetch from 'node-fetch';
import FormData from 'form-data';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // 允許手機大張照片上傳
    },
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
      return res.status(400).json({ success: false, error: '沒有收到圖片資料' });
    }

    // 將 Base64 轉回 Buffer 透過後端傳到 telegra.ph 匿名圖床
    const buffer = Buffer.from(imageBase64, 'base64');
    const formData = new FormData();
    formData.append('file', buffer, { filename: 'upload.jpg', contentType: mimeType || 'image/jpeg' });

    const uploadRes = await fetch('https://telegra.ph/upload', {
      method: 'POST',
      body: formData
    });

    const result = await uploadRes.json();
    
    // Telegraph 回傳格式為陣列，例如 [{ src: "/file/xxxx.jpg" }]
    if (Array.isArray(result) && result[0]?.src) {
      const fullLink = `https://telegra.ph${result[0].src}`;
      return res.status(200).json({ success: true, link: fullLink });
    } else if (result.error) {
      throw new Error(result.error);
    } else {
      throw new Error('圖片上傳伺服器回應格式錯誤');
    }

  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}