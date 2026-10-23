import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const dbId = process.env.DATABASE_ID; // 訂單表的 Database ID

    if (!dbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 DATABASE_ID 環境變數' });
    }

    const { nickname, contactType, contactInfo, delivery, note, items } = req.body;

    if (!nickname || !contactInfo || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: '訂單資料不完整' });
    }

    // 逐筆將購物車品項寫入 Notion 訂單資料庫
    for (const item of items) {
      const properties = {
        // 1. 買家暱稱 (Title)
        "買家暱稱": {
          title: [{ text: { content: nickname || '訪客' } }]
        },
        // 2. 聯絡帳號 (Rich Text) -> 只放帳號內容 (例如 sS)
        "聯絡帳號": {
          rich_text: [{ text: { content: contactInfo } }]
        },
        // 3. 聯絡管道 (Select 或 Rich Text) -> 放類型 (例如 LINE ID)
        "聯絡管道": {
          select: { name: contactType || 'LINE ID' }
        },
        // 4. 商品名稱 (Rich Text)
        "商品名稱": {
          rich_text: [{ text: { content: item.product || '' } }]
        },
        // 5. 規格款式 (Rich Text)
        "規格款式": {
          rich_text: [{ text: { content: item.spec || '標準款式' } }]
        },
        // 6. 數量 (Number)
        "數量": {
          number: item.quantity || 1
        },
        // 7. 總金額 / 單價 (Number) -> 確保寫入正確金額
        "總金額": {
          number: item.totalPrice || 0
        },
        // 8. 取貨方式 (Select)
        "取貨方式": {
          select: { name: delivery || '7-11 店到店' }
        },
        // 9. 備註 (Rich Text)
        "備註": {
          rich_text: [{ text: { content: note || '' } }]
        },
        // 10. 出貨狀態 (Status)
        "出貨狀態": {
          status: { name: '備貨中' }
        },
        // 11. 付款狀態 (Status)
        "付款狀態": {
          status: { name: '未付款' }
        }
      };

      // 如果有圖片網址，寫入檔案欄位
      if (item.imageUrl) {
        properties["商品圖片"] = {
          files: [{
            name: "product_image.jpg",
            external: { url: item.imageUrl }
          }]
        };
      }

      await notion.pages.create({
        parent: { database_id: dbId },
        properties: properties
      });
    }

    return res.status(200).json({ success: true, message: '訂單建立成功' });

  } catch (error) {
    console.error("Create Order Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
