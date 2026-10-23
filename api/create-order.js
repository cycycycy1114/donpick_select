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

    // 先查詢一次訂單資料庫，取得現有的欄位名稱與屬性類型 (Property Schema)
    const dbInfo = await notion.databases.retrieve({ database_id: dbId });
    const schema = dbInfo.properties || {};

    // 輔助函式：根據關鍵字尋找 Notion 資料庫中正確的欄位名稱與型態
    const findPropKey = (keywords) => {
      for (const key of Object.keys(schema)) {
        const lowerKey = key.toLowerCase();
        for (const kw of keywords) {
          if (lowerKey.includes(kw.toLowerCase())) {
            return { name: key, type: schema[key].type };
          }
        }
      }
      return null;
    };

    const titleProp = Object.keys(schema).find(k => schema[k].type === 'title') || '買家暱稱';

    const contactProp = findPropKey(['聯絡', '帳號', 'contact', 'id']);
    const productProp = findPropKey(['商品', '品項', 'product']);
    const specProp = findPropKey(['規格', '款式', 'spec']);
    const qtyProp = findPropKey(['數量', 'qty', 'quantity']);
    const priceProp = findPropKey(['總金額', '總價', '金額', 'price', 'total']);
    const deliveryProp = findPropKey(['取貨', '寄送', 'delivery']);
    const noteProp = findPropKey(['備註', 'note', '許願']);
    const imgProp = findPropKey(['圖片', 'image', 'file']);
    const fulfillProp = findPropKey(['出貨', '物流', 'fulfillment']);
    const payProp = findPropKey(['付款', '金流', 'payment']);

    // 逐筆寫入訂單
    for (const item of items) {
      const properties = {};

      // 1. 標題 (Title)
      properties[titleProp] = {
        title: [{ text: { content: nickname || '訪客' } }]
      };

      // 2. 聯絡方式
      if (contactProp) {
        const contactVal = `${contactType}: ${contactInfo}`;
        if (contactProp.type === 'rich_text') {
          properties[contactProp.name] = { rich_text: [{ text: { content: contactVal } }] };
        } else if (contactProp.type === 'select') {
          properties[contactProp.name] = { select: { name: contactVal } };
        }
      }

      // 3. 商品名稱
      if (productProp) {
        const prodVal = item.product || '';
        if (productProp.type === 'rich_text') {
          properties[productProp.name] = { rich_text: [{ text: { content: prodVal } }] };
        } else if (productProp.type === 'title') {
          properties[productProp.name] = { title: [{ text: { content: prodVal } }] };
        }
      }

      // 4. 規格款式
      if (specProp) {
        const specVal = item.spec || '標準款式';
        if (specProp.type === 'rich_text') {
          properties[specProp.name] = { rich_text: [{ text: { content: specVal } }] };
        } else if (specProp.type === 'select') {
          properties[specProp.name] = { select: { name: specVal } };
        }
      }

      // 5. 數量
      if (qtyProp && qtyProp.type === 'number') {
        properties[qtyProp.name] = { number: item.quantity || 1 };
      }

      // 6. 總金額
      if (priceProp && priceProp.type === 'number') {
        properties[priceProp.name] = { number: item.totalPrice || 0 };
      }

      // 7. 取貨方式
      if (deliveryProp) {
        const delVal = delivery || '7-11 店到店';
        if (deliveryProp.type === 'select') {
          properties[deliveryProp.name] = { select: { name: delVal } };
        } else if (deliveryProp.type === 'rich_text') {
          properties[deliveryProp.name] = { rich_text: [{ text: { content: delVal } }] };
        }
      }

      // 8. 備註
      if (noteProp) {
        const noteVal = note || '';
        if (noteProp.type === 'rich_text') {
          properties[noteProp.name] = { rich_text: [{ text: { content: noteVal } }] };
        }
      }

      // 9. 圖片
      if (imgProp && imgProp.type === 'files' && item.imageUrl) {
        properties[imgProp.name] = {
          files: [{
            name: "product_image.jpg",
            external: { url: item.imageUrl }
          }]
        };
      }

      // 10. 出貨狀態
      if (fulfillProp) {
        if (fulfillProp.type === 'status') {
          properties[fulfillProp.name] = { status: { name: '備貨中' } };
        } else if (fulfillProp.type === 'select') {
          properties[fulfillProp.name] = { select: { name: '備貨中' } };
        }
      }

      // 11. 付款狀態
      if (payProp) {
        if (payProp.type === 'status') {
          properties[payProp.name] = { status: { name: '未付款' } };
        } else if (payProp.type === 'select') {
          properties[payProp.name] = { select: { name: '未付款' } };
        }
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
