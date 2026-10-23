import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const wishDbId = process.env.WISH_DATABASE_ID || process.env.WISH_DB_ID;
    if (!wishDbId) {
      return res.status(500).json({ success: false, error: '未設定 WISH_DATABASE_ID 環境變數' });
    }

    const { contact, product, location, budget } = req.body;
    if (!contact || !product) {
      return res.status(400).json({ success: false, error: '請填寫聯絡人與想許願的商品' });
    }

    // 取得 Notion 許願資料庫的 Schema 結構以進行智慧對應
    const dbInfo = await notion.databases.retrieve({ database_id: wishDbId });
    const schema = dbInfo.properties || {};

    const findProp = (keywords) => {
      for (const k of Object.keys(schema)) {
        const lk = k.toLowerCase();
        for (const kw of keywords) {
          if (lk.includes(kw.toLowerCase())) return { name: k, type: schema[k].type };
        }
      }
      return null;
    };

    const titleProp = Object.keys(schema).find(k => schema[k].type === 'title') || '商品名稱';
    const contactProp = findProp(['聯絡', '暱稱', 'contact', 'name']);
    const locProp = findProp(['地點', '國家', 'location', '地方']);
    const budgetProp = findProp(['預算', '價格', 'budget', 'price']);

    const properties = {};
    properties[titleProp] = { title: [{ text: { content: product } }] };

    if (contactProp) {
      if (contactProp.type === 'rich_text') properties[contactProp.name] = { rich_text: [{ text: { content: contact } }] };
      else if (contactProp.type === 'select') properties[contactProp.name] = { select: { name: contact } };
    }

    if (locProp && location) {
      if (locProp.type === 'rich_text') properties[locProp.name] = { rich_text: [{ text: { content: location } }] };
      else if (locProp.type === 'select') properties[locProp.name] = { select: { name: location } };
    }

    if (budgetProp && budget) {
      if (budgetProp.type === 'number') properties[budgetProp.name] = { number: parseFloat(budget) || 0 };
      else if (budgetProp.type === 'rich_text') properties[budgetProp.name] = { rich_text: [{ text: { content: String(budget) } }] };
    }

    await notion.pages.create({
      parent: { database_id: wishDbId },
      properties: properties
    });

    return res.status(200).json({ success: true, message: '許願成功' });

  } catch (error) {
    console.error("Wish Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
