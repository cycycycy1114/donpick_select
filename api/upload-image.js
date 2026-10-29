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

    const githubToken = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO; // 格式: "username/repo"
    const branch = process.env.GITHUB_BRANCH || 'main';

    if (!githubToken || !repo) {
      return res.status(500).json({ success: false, error: '伺服器未設定 GitHub 圖床環境變數' });
    }

    // 產生獨一無二的檔名（以時間戳命名存放在 uploads/ 資料夾中）
    const ext = mimeType && mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = `upload_${Date.now()}.${ext}`;
    const filePath = `uploads/${fileName}`;

    const githubApiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    // 呼叫 GitHub API 建立檔案 (Commit)
    const githubResponse = await fetch(githubApiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DonPick-Image-Uploader'
      },
      body: JSON.stringify({
        message: `Upload image ${fileName} via DonPick system [skip ci]`, // 💡 加上 [skip ci] 讓 Vercel 自動略過
        content: imageBase64,
        branch: branch
      })
    });

    const result = await githubResponse.json();

    if (githubResponse.ok) {
      // 組合出永久有效的 GitHub Raw 直連網址
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
      return res.status(200).json({ success: true, link: rawUrl });
    } else {
      throw new Error(result.message || 'GitHub 上傳失敗');
    }

  } catch (error) {
    console.error("GitHub Upload Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}