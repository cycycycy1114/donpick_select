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

    // 1. 取得 Notion 許願資料庫的 Schema 結構
    const dbInfo = await notion.databases.retrieve({ database_id: wishDbId });
    const schema = dbInfo.properties || {};

    // 2. 智慧搜尋欄位名稱的輔助函式（支援多種常見命名）
    const findPropName = (keywords) => {
      for (const k of Object.keys(schema)) {
        const lk = k.trim().toLowerCase();
        for (const kw of keywords) {
          if (lk.includes(kw.toLowerCase())) return k;
        }
      }
      return null;
    };

    // 找出 Title 標題欄位（通常是商品名稱 / 許願品項）
    const titleKey = Object.keys(schema).find(k => schema[k].type === 'title') || '商品名稱';
    
    // 找出其他對應欄位
    const contactKey = findPropName(['聯絡', '暱稱', 'contact', 'name']) || '聯絡人';
    const locKey = findPropName(['地點', '國家', 'location', '地方', '地區']) || '採購地點';
    const budgetKey = findPropName(['預算', '價格', 'budget', 'price']) || '預算';

    const properties = {};

    // 填入標題 (Title)
    properties[titleKey] = { 
      title: [{ text: { content: product } }] 
    };

    // 填入聯絡人 (Rich Text / Select)
    if (schema[contactKey]) {
      const type = schema[contactKey].type;
      if (type === 'rich_text') {
        properties[contactKey] = { rich_text: [{ text: { content: contact } }] };
      } else if (type === 'select') {
        properties[contactKey] = { select: { name: contact } };
      }
    }

    // 填入地點 (Rich Text / Select)
    if (location && schema[locKey]) {
      const type = schema[locKey].type;
      if (type === 'rich_text') {
        properties[locKey] = { rich_text: [{ text: { content: location } }] };
      } else if (type === 'select') {
        properties[locKey] = { select: { name: location } };
      }
    }

    // 填入預算 (Number / Rich Text)
    if (budget && schema[budgetKey]) {
      const type = schema[budgetKey].type;
      if (type === 'number') {
        properties[budgetKey] = { number: parseFloat(budget) || 0 };
      } else if (type === 'rich_text') {
        properties[budgetKey] = { rich_text: [{ text: { content: String(budget) } }] };
      }
    }

    // 3. 建立 Notion 頁面
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
