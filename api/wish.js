import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    // 這裡可以直接寫入您的訂單表 DATABASE_ID，或另外開一個許願專用 DB ID
    const dbId = process.env.WISH_DATABASE_ID || process.env.DATABASE_ID;

    if (!notionToken || !dbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });
    const { nickname, contactInfo, productName, location, budget, note } = req.body;

    if (!productName) {
      return res.status(400).json({ success: false, error: '請填寫想許願的商品名稱' });
    }

    // 寫入 Notion 資料庫
    await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        "買家暱稱": {
          title: [{ text: { content: nickname || '匿名許願者' } }]
        },
        "聯絡方式": {
          rich_text: [{ text: { content: contactInfo || '未填寫' } }]
        },
        "商品名稱": {
          rich_text: [{ text: { content: `✨ [許願] ${productName}` } }]
        },
        "規格款式": {
          rich_text: [{ text: { content: `地點：${location || '未指定'} | 預算：${budget || '無上限'}` } }]
        },
        "備註": {
          rich_text: [{ text: { content: note || '粉絲許願' } }]
        },
        "出貨狀態": {
          status: { name: '備貨中' }
        },
        "付款狀態": {
          status: { name: '未付款' }
        }
      }
    });

    return res.status(200).json({ success: true, message: '許願成功！' });

  } catch (error) {
    console.error("Wish API Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
