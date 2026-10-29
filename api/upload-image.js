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

    // 安全回傳 Data URL 供前端預覽與暫存，不寫入 GitHub 倉庫
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

    return res.status(200).json({ success: true, link: dataUrl });

  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}