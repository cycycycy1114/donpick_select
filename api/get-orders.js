import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const keyword = (req.query.keyword || '').trim();
    const dbId = process.env.DATABASE_ID; // 訂單表的 Database ID

    if (!dbId) {
      return res.status(500).json({ success: false, error: "缺少 DATABASE_ID 環境變數" });
    }

    if (!keyword) {
      return res.status(400).json({ success: false, error: '請輸入查詢的暱稱或聯絡帳號' });
    }

    // 查詢 Notion 訂單資料庫
    const response = await notion.databases.query({
      database_id: dbId,
      page_size: 100
    });

    const rawRows = [];

    response.results.forEach(page => {
      const p = page.properties || {};
      
      let nickname = '';
      let contactInfo = '';
      let product = '';
      let spec = '';
      let quantity = 1;
      let totalPrice = 0;
      let delivery = '未填寫';
      let note = '';
      let fulfillmentStatus = '備貨中';
      let paymentStatus = '未付款';

      // 🎯 智慧辨識各個 Notion 欄位
      Object.keys(p).forEach(k => {
        const prop = p[k];
        const lowerKey = k.toLowerCase();

        if (prop.type === 'title' && prop.title?.[0]) {
          nickname = prop.title.map(t => t.plain_text).join('');
        } else if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
          const textVal = prop.rich_text.map(t => t.plain_text).join('');
          
          if (lowerKey.includes('暱稱') || lowerKey.includes('買家') || lowerKey.includes('name')) {
            nickname = textVal || nickname;
          } else if (lowerKey.includes('聯絡') || lowerKey.includes('帳號') || lowerKey.includes('id')) {
            contactInfo = textVal;
          } else if (lowerKey.includes('商品') || lowerKey.includes('品項') || lowerKey === 'product') {
            product = textVal;
          } else if (lowerKey.includes('規格') || lowerKey.includes('款式') || lowerKey.includes('spec')) {
            spec = textVal;
          } else if (lowerKey.includes('備註') || lowerKey.includes('許願') || lowerKey.includes('note')) {
            note = textVal;
          }
        } else if (prop.type === 'select' && prop.select?.name) {
          const selectVal = prop.select.name;
          
          // 🎯 嚴格區分「取貨方式」與「出貨/物流狀態」
          if (lowerKey.includes('取貨') || lowerKey.includes('寄送') || lowerKey.includes('delivery')) {
            delivery = selectVal;
          } else if (lowerKey.includes('出貨狀態') || lowerKey.includes('物流狀態') || lowerKey.includes('fulfillment')) {
            fulfillmentStatus = selectVal;
          } else if (lowerKey.includes('付款') || lowerKey.includes('金流') || lowerKey.includes('payment')) {
            paymentStatus = selectVal;
          } else {
            // 如果只有一般狀態欄位，預設給出貨狀態
            if (lowerKey.includes('狀態') && !lowerKey.includes('付款')) {
              fulfillmentStatus = selectVal;
            }
          }
        } else if (prop.type === 'status' && prop.status?.name) {
          const statusVal = prop.status.name;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流') || lowerKey.includes('fulfillment')) {
            fulfillmentStatus = statusVal;
          } else if (lowerKey.includes('付款') || lowerKey.includes('金流') || lowerKey.includes('payment')) {
            paymentStatus = statusVal;
          }
        } else if (prop.type === 'number') {
          if (lowerKey.includes('數量') || lowerKey.includes('quantity')) quantity = prop.number || 1;
          if (lowerKey.includes('總金額') || lowerKey.includes('總價') || lowerKey.includes('total') || lowerKey.includes('金額')) {
            totalPrice = prop.number || 0;
          }
        }
      });

      // 檢查是否符合買家輸入的關鍵字
      const matchKeyword = keyword.toLowerCase();
      const matchName = nickname.toLowerCase().includes(matchKeyword);
      const matchContact = contactInfo.toLowerCase().includes(matchKeyword);

      if (matchName || matchContact) {
        rawRows.push({
          nickname,
          contactInfo,
          product: product || '未命名商品',
          spec: spec || '標準款式',
          quantity: quantity,
          totalPrice: totalPrice,
          delivery: delivery,
          note,
          fulfillmentStatus,
          paymentStatus,
          createdAt: page.created_time ? page.created_time.substring(0, 16).replace('T', ' ') : '',
          rawTime: page.created_time ? new Date(page.created_time).getTime() : 0
        });
      }
    });

    // 🎯 把同一次結帳的品項群組化
    const groupedOrdersMap = {};

    rawRows.forEach(row => {
      const timeKey = row.createdAt; 
      if (!groupedOrdersMap[timeKey]) {
        groupedOrdersMap[timeKey] = {
          nickname: row.nickname,
          contactInfo: row.contactInfo,
          delivery: row.delivery !== '未填寫' ? row.delivery : '7-11 店到店', // 預設防呆
          note: row.note,
          fulfillmentStatus: row.fulfillmentStatus,
          paymentStatus: row.paymentStatus,
          createdAt: row.createdAt,
          items: [],
          grandTotal: 0,
          unpaidTotal: 0
        };
      } else {
        // 如果前面沒抓到取貨方式，後續補上
        if (row.delivery !== '未填寫' && groupedOrdersMap[timeKey].delivery === '7-11 店到店') {
          groupedOrdersMap[timeKey].delivery = row.delivery;
        }
      }

      groupedOrdersMap[timeKey].items.push({
        product: row.product,
        spec: row.spec,
        quantity: row.quantity,
        price: row.totalPrice
      });

      groupedOrdersMap[timeKey].grandTotal += row.totalPrice;

      if (!row.paymentStatus.includes('已付款') && !row.paymentStatus.includes('結清')) {
        groupedOrdersMap[timeKey].unpaidTotal += row.totalPrice;
      }
    });

    const orders = Object.values(groupedOrdersMap);

    return res.status(200).json({ success: true, orders });

  } catch (error) {
    console.error("Query Orders Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
