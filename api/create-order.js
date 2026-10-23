import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { nickname, contactType, contactInfo, delivery, note, items } = req.body;
    const dbId = process.env.DATABASE_ID; // 訂單表的 Database ID

    if (!dbId || !items || items.length === 0) {
      return res.status(400).json({ success: false, error: '缺少必要的訂單資料或環境變數' });
    }

    // 逐一建立訂單項目至 Notion
    for (const item of items) {
      await notion.pages.create({
        parent: { database_id: dbId },
        properties: {
          "買家暱稱": { title: [{ text: { content: nickname || '訪客' } }] },
          "聯絡方式": { rich_text: [{ text: { content: `${contactType}: ${contactInfo}` } }] },
          "商品名稱": { rich_text: [{ text: { content: item.product || '' } }] },
          "規格": { rich_text: [{ text: { content: item.spec || '' } }] },
          "數量": { number: item.quantity || 1 },
          "總金額": { number: item.totalPrice || 0 },
          "取貨方式": { select: { name: delivery || '7-11 店到店' } },
          "備註": { rich_text: [{ text: { content: note || '' } }] }
        }
      });
    }

    return res.status(200).json({ success: true, message: '訂單建立成功' });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
