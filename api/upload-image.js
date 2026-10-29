import fetch from 'node-fetch';
import FormData from 'form-data';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
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

    const buffer = Buffer.from(imageBase64, 'base64');
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', buffer, { filename: 'upload.jpg', contentType: mimeType || 'image/jpeg' });

    // 💡 改用 Catbox 匿名圖床 API，回傳結果直接就是純文字網址
    const uploadRes = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: formData
    });

    const link = await uploadRes.text();
    
    if (uploadRes.ok && link && link.startsWith('http')) {
      return res.status(200).json({ success: true, link: link.trim() });
    } else {
      throw new Error(link || '圖片上傳伺服器回應失敗');
    }

  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}