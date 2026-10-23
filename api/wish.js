import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { contact, product, location, budget } = req.body;
    const wishDbId = process.env.WISH_DATABASE_ID || process.env.DATABASE_ID;

    await notion.pages.create({
      parent: { database_id: wishDbId },
      properties: {
        "商品名稱": { title: [{ text: { content: product || '許願商品' } }] },
        "聯絡人": { rich_text: [{ text: { content: contact || '' } }] },
        "購買地點": { rich_text: [{ text: { content: location || '' } }] },
        "預算範圍": { rich_text: [{ text: { content: budget || '' } }] }
      }
    });

    return res.status(200).json({ success: true, message: '許願成功' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
