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

    // 1. 自動讀取 Notion 許願資料庫的真實 Schema 結構
    const dbInfo = await notion.databases.retrieve({ database_id: wishDbId });
    const schema = dbInfo.properties || {};

    // 印出 Notion 資料庫目前的真實欄位，方便您在 Vercel Logs 中查看
    console.log("Notion 許願表真實 Schema:", JSON.stringify(schema, null, 2));

    // 2. 自動找出 Title 欄位名稱
    const titleKey = Object.keys(schema).find(k => schema[k].type === 'title');
    if (!titleKey) {
      return res.status(500).json({ success: false, error: 'Notion 許願資料庫中找不到 Title (標題) 欄位' });
    }

    // 3. 動態尋找聯絡人欄位（尋找包含「聯絡」、「暱稱」、「contact」、「name」的欄位）
    const contactKey = Object.keys(schema).find(k => {
      const lk = k.toLowerCase();
      return lk.includes('聯絡') || lk.includes('暱稱') || lk.includes('contact') || lk.includes('name');
    });

    const properties = {};
    properties[titleKey] = {
      title: [{ text: { content: product } }]
    };

    if (contactKey) {
      const type = schema[contactKey].type;
      if (type === 'rich_text') {
        properties[contactKey] = { rich_text: [{ text: { content: contact } }] };
      } else if (type === 'select') {
        properties[contactKey] = { select: { name: contact } };
      }
    }

    // 4. 寫入 Notion
    await notion.pages.create({
      parent: { database_id: wishDbId },
      properties: properties
    });

    return res.status(200).json({ success: true, message: '許願成功' });

  } catch (error) {
    console.error("Wish API Error Detail:", error);
    // 把詳細的錯誤訊息直接回傳給前端，方便您看哪裡出錯
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
