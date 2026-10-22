import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const dbId = process.env.WISH_DATABASE_ID || process.env.DATABASE_ID;

    if (!notionToken || !dbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });
    const { nickname, contactInfo, productName, location, budget, imageUrl } = req.body;

    if (!productName) {
      return res.status(400).json({ success: false, error: '請填寫想許願的商品名稱' });
    }

    const properties = {
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
        rich_text: [{ text: { content: '粉絲許願單（附參考圖）' } }]
      },
      "出貨狀態": {
        status: { name: '備貨中' }
      },
      "付款狀態": {
        status: { name: '未付款' }
      }
    };

    // 如果使用者有上傳參考圖片，一併寫入 Notion 檔案欄位
    if (imageUrl) {
      properties["商品圖片"] = {
        files: [{
          name: "wish_reference.jpg",
          external: { url: imageUrl }
        }]
      };
    }

    await notion.pages.create({
      parent: { database_id: dbId },
      properties: properties
    });

    return res.status(200).json({ success: true, message: '許願成功！' });

  } catch (error) {
    console.error("Wish API Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
