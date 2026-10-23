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

    // 1. 動態取得 Notion 訂單資料庫的真實欄位結構 (Schema)
    const dbInfo = await notion.databases.retrieve({ database_id: dbId });
    const schema = dbInfo.properties || {};

    // 輔助函式：根據關鍵字找出 Notion 裡的真實欄位名稱
    const getPropName = (keywords) => {
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

    // 找出各個欄位的真實名稱與型態
    const titleProp = Object.keys(schema).find(k => schema[k].type === 'title') || '買家暱稱';
    const accountProp = getPropName(['聯絡帳號', '帳號', 'account']);
    const channelProp = getPropName(['聯絡管道', '管道', 'channel']);
    const productProp = getPropName(['商品名稱', '品項', 'product', '商品']);
    const specProp = getPropName(['規格款式', '規格', '款式', 'spec']);
    const qtyProp = getPropName(['數量', 'qty', 'quantity']);
    const priceProp = getPropName(['總金額', '總價', '金額', 'price', 'total']);
    const deliveryProp = getPropName(['取貨方式', '寄送', 'delivery', '取貨']);
    const noteProp = getPropName(['備註', 'note', '許願']);
    const imgProp = getPropName(['商品圖片', '圖片', 'image', 'file']);
    const fulfillProp = getPropName(['出貨狀態', '出貨', '物流', 'fulfillment']);
    const payProp = getPropName(['付款狀態', '付款', '金流', 'payment']);

    // 逐筆將購物車品項寫入 Notion
    for (const item of items) {
      const properties = {};

      // 1. 買家暱稱 (Title)
      properties[titleProp] = {
        title: [{ text: { content: nickname || '訪客' } }]
      };

      // 2. 聯絡帳號 (確保只放帳號內容，如 sS)
      if (accountProp) {
        if (accountProp.type === 'rich_text') {
          properties[accountProp.name] = { rich_text: [{ text: { content: contactInfo } }] };
        } else if (accountProp.type === 'select') {
          properties[accountProp.name] = { select: { name: contactInfo } };
        }
      }

      // 3. 聯絡管道 (放類型，如 LINE ID)
      if (channelProp) {
        if (channelProp.type === 'select') {
          properties[channelProp.name] = { select: { name: contactType || 'LINE ID' } };
        } else if (channelProp.type === 'rich_text') {
          properties[channelProp.name] = { rich_text: [{ text: { content: contactType || 'LINE ID' } }] };
        }
      }

      // 4. 商品名稱
      if (productProp) {
        const prodVal = item.product || '';
        if (productProp.type === 'rich_text') {
          properties[productProp.name] = { rich_text: [{ text: { content: prodVal } }] };
        } else if (productProp.type === 'title') {
          properties[productProp.name] = { title: [{ text: { content: prodVal } }] };
        }
      }

      // 5. 規格款式
      if (specProp) {
        const specVal = item.spec || '標準款式';
        if (specProp.type === 'rich_text') {
          properties[specProp.name] = { rich_text: [{ text: { content: specVal } }] };
        } else if (specProp.type === 'select') {
          properties[specProp.name] = { select: { name: specVal } };
        }
      }

      // 6. 數量
      if (qtyProp && qtyProp.type === 'number') {
        properties[qtyProp.name] = { number: item.quantity || 1 };
      }

      // 7. 總金額
      if (priceProp && priceProp.type === 'number') {
        properties[priceProp.name] = { number: item.totalPrice || 0 };
      }

      // 8. 取貨方式
      if (deliveryProp) {
        const delVal = delivery || '7-11 店到店';
        if (deliveryProp.type === 'select') {
          properties[deliveryProp.name] = { select: { name: delVal } };
        } else if (deliveryProp.type === 'rich_text') {
          properties[deliveryProp.name] = { rich_text: [{ text: { content: delVal } }] };
        }
      }

      // 9. 備註
      if (noteProp && noteProp.type === 'rich_text') {
        properties[noteProp.name] = { rich_text: [{ text: { content: note || '' } }] };
      }

      // 10. 商品圖片
      if (imgProp && imgProp.type === 'files' && item.imageUrl) {
        properties[imgProp.name] = {
          files: [{
            name: "product_image.jpg",
            external: { url: item.imageUrl }
          }]
        };
      }

      // 11. 出貨狀態
      if (fulfillProp) {
        if (fulfillProp.type === 'status') {
          properties[fulfillProp.name] = { status: { name: '備貨中' } };
        } else if (fulfillProp.type === 'select') {
          properties[fulfillProp.name] = { select: { name: '備貨中' } };
        }
      }

      // 12. 付款狀態
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
