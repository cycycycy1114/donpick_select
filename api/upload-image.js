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

    // 將 Base64 轉回 Buffer 透過後端幫你傳到 Imgur（後端繞過 CORS 限制）
    const buffer = Buffer.from(imageBase64, 'base64');
    const formData = new FormData();
    formData.append('image', buffer, { filename: 'upload.jpg', contentType: mimeType || 'image/jpeg' });

    const imgurRes = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        Authorization: 'Client-ID 560248f76633fb6',
        ...formData.getHeaders()
      },
      body: formData
    });

    const result = await imgurRes.json();
    if (result.success) {
      return res.status(200).json({ success: true, link: result.data.link });
    } else {
      throw new Error(result.data?.error?.message || 'Imgur 上傳失敗');
    }

  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}