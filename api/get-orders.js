import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const keyword = (req.query.keyword || '').trim();
    const dbId = process.env.DATABASE_ID;                      // 訂單表的 Database ID
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID; // 商品款式明細表 C 表 ID

    if (!dbId) {
      return res.status(500).json({ success: false, error: "缺少 DATABASE_ID 環境變數" });
    }

    if (!keyword) {
      return res.status(400).json({ success: false, error: '請輸入查詢的暱稱或聯絡帳號' });
    }

    // 1. 建立商品 C 表的圖片與正確規格對照字典（以「主商品名_款式名」為 Key）
    let productDict = {};
    if (productDetailDbId) {
      try {
        const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
        cRes.results.forEach(page => {
          const p = page.properties || {};
          
          // 抓取款式名稱 (Title)
          let styleName = '';
          const titleKey = Object.keys(p).find(k => p[k].type === 'title');
          if (titleKey && p[titleKey]?.title?.[0]) {
            styleName = p[titleKey].title.map(t => t.plain_text).join('').trim();
          }

          // 抓取圖片
          let imageUrl = '';
          const imgKey = Object.keys(p).find(k => p[k].type === 'files' || k.includes('圖'));
          if (imgKey && p[imgKey]?.files?.[0]) {
            const fileObj = p[imgKey].files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }

          if (styleName) {
            productDict[styleName] = { imageUrl, styleName };
          }
        });
      } catch (e) {
        console.warn('讀取商品明細表字典失敗:', e.message);
      }
    }

    // 2. 查詢 Notion 訂單資料庫
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
      let delivery = '7-11 店到店';
      let note = '';
      let fulfillmentStatus = '備貨中';
      let paymentStatus = '未付款';
      let imageUrl = '';

      // 智慧辨識訂單各欄位
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
          if (lowerKey.includes('取貨') || lowerKey.includes('寄送') || lowerKey.includes('delivery')) {
            delivery = selectVal;
          } else if (lowerKey.includes('出貨狀態') || lowerKey.includes('物流狀態') || lowerKey.includes('fulfillment')) {
            fulfillmentStatus = selectVal;
          } else if (lowerKey.includes('付款') || lowerKey.includes('金流') || lowerKey.includes('payment')) {
            paymentStatus = selectVal;
          }
        } else if (prop.type === 'status' && prop.status?.name) {
          const statusVal = prop.status.name;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = statusVal;
          if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = statusVal;
        } else if (prop.type === 'number') {
          if (lowerKey.includes('數量') || lowerKey.includes('quantity')) quantity = prop.number || 1;
          if (lowerKey.includes('總金額') || lowerKey.includes('總價') || lowerKey.includes('total') || lowerKey.includes('金額')) {
            totalPrice = prop.number || 0;
          }
        } else if (prop.type === 'files') {
          if (prop.files?.[0]) {
            const fileObj = prop.files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }
        }
      });

      // 🎯 自動偵測與補齊規格：如果訂單裡的 spec 是空的或標準款式，但商品名稱裡面帶有規格，自動拆解
      if ((!spec || spec === '標準款式') && product.includes(' - ')) {
        const parts = product.split(' - ');
        product = parts[0].trim();
        spec = parts.slice(1).join(' - ').trim();
      }

      // 🎯 如果商品字典裡找得到對應的款式名稱，自動補上圖片和小縮圖
      if (productDict[spec]) {
        if (!imageUrl) imageUrl = productDict[spec].imageUrl;
      } else if (productDict[product]) {
        if (!imageUrl) imageUrl = productDict[product].imageUrl;
      }

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
          delivery,
          note,
          fulfillmentStatus,
          paymentStatus,
          imageUrl,
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
          delivery: row.delivery,
          note: row.note,
          fulfillmentStatus: row.fulfillmentStatus,
          paymentStatus: row.paymentStatus,
          createdAt: row.createdAt,
          items: [],
          grandTotal: 0,
          unpaidTotal: 0
        };
      }

      groupedOrdersMap[timeKey].items.push({
        product: row.product,
        spec: row.spec,
        quantity: row.quantity,
        price: row.totalPrice,
        imageUrl: row.imageUrl
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
