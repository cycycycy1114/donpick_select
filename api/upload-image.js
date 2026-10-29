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

    // 💡 這裡我們直接將圖片以 Data URL (Base64) 形式回傳給前端
    // 這樣不僅不需要依賴外部圖床，而且可以直接相容於 Notion 外部檔案或網頁預覽
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

    return res.status(200).json({ success: true, link: dataUrl });

  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}