import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const keyword = (req.query.keyword || '').trim();
    const dbId = process.env.DATABASE_ID;                      // 訂單表 ID
    const productDbId = process.env.PRODUCT_DB_ID;              // B表（主商品表）ID
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID; // C表（款式明細表）ID

    if (!dbId) {
      return res.status(500).json({ success: false, error: "缺少 DATABASE_ID 環境變數" });
    }

    if (!keyword) {
      return res.status(400).json({ success: false, error: '請輸入查詢的暱稱或聯絡帳號' });
    }

    // 1. 先讀取 B 表（主商品表），建立 ID ➔ 主商品名稱的對照字典 (bMapById)
    let bMapById = {};
    if (productDbId) {
      try {
        const bRes = await notion.databases.query({ database_id: productDbId, page_size: 100 });
        if (bRes && bRes.results) {
          bRes.results.forEach(page => {
            const p = page?.properties || {};
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title?.[0]) {
              const name = p[titleKey].title.map(t => t?.plain_text || '').join('').trim();
              if (name) {
                bMapById[page.id] = name;
              }
            }
          });
        }
      } catch (e) {
        console.warn('讀取 B 表失敗:', e.message);
      }
    }

    // 2. 讀取 C 表（款式明細表），透過 Relation 找到 B 表的主商品名稱，並建立圖片字典
    let productDict = {};
    if (productDetailDbId) {
      try {
        const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
        if (cRes && cRes.results) {
          cRes.results.forEach(page => {
            const p = page?.properties || {};

            let parentName = '';
            const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
            if (relKey && p[relKey]?.relation && Array.isArray(p[relKey].relation) && p[relKey].relation.length > 0) {
              const relId = p[relKey].relation[0]?.id;
              if (relId && bMapById[relId]) {
                parentName = bMapById[relId]; 
              }
            }

            if (!parentName) {
              const textKey = Object.keys(p).find(k => k.includes('商品') || k.includes('主商品') || k.includes('Product'));
              if (textKey && p[textKey]?.rich_text?.[0]) {
                parentName = p[textKey].rich_text.map(t => t?.plain_text || '').join('').trim();
              }
            }

            let styleName = '圖片款';
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title?.[0]) {
              styleName = p[titleKey].title.map(t => t?.plain_text || '').join('').trim() || '圖片款';
            }

            let imageUrl = '';
            Object.keys(p).forEach(k => {
              const prop = p[k];
              if (!prop) return;
              const lowerK = k.toLowerCase();
              if (prop.type === 'files' || lowerK.includes('款式圖片') || lowerK.includes('圖片')) {
                if (prop.files && Array.isArray(prop.files) && prop.files.length > 0) {
                  const fileObj = prop.files[0];
                  imageUrl = fileObj?.file?.url || fileObj?.external?.url || imageUrl;
                }
              }
            });

            // 2. 💡 雙軌保險：如果 files 抓不到（例如是放長 Base64 在文字欄位），改從 rich_text 欄位抓取
            if (!imageUrl) {
              Object.keys(p).forEach(k => {
                const prop = p[k];
                if (!prop) return;
                const lowerK = k.toLowerCase();

                if (prop.type === 'rich_text' && (lowerK.includes('款式圖片') || lowerK.includes('圖片') || lowerK.includes('備份'))) {
                  if (prop.rich_text && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
                    const textVal = prop.rich_text.map(t => t?.plain_text || '').join('').trim();
                    if (textVal) {
                      imageUrl = textVal;
                    }
                  }
                }
              });
            }

            if (imageUrl) {
              const cleanParent = (parentName || '').trim();
              const cleanStyle = (styleName || '').trim();

              if (cleanParent) {
                productDict[`${cleanParent}_${cleanStyle}`] = imageUrl;
                productDict[`${cleanParent}_標準款式`] = imageUrl;
                productDict[cleanParent] = imageUrl;
              }
              productDict[cleanStyle] = imageUrl;
            }
          });
        }
      } catch (e) {
        console.warn('讀取 C 表失敗:', e.message);
      }
    }

    // 3. 查詢 Notion 訂單資料庫
    const response = await notion.databases.query({
      database_id: dbId,
      page_size: 100
    });

    const rawRows = [];

    if (response && response.results) {
      response.results.forEach(page => {
        const p = page?.properties || {};
        
        let nickname = '';
        let contactInfo = '';
        let contactChannel = '';
        let product = '';
        let spec = '圖片款';
        let quantity = 1;
        let totalPrice = 0;
        let delivery = '7-11 店到店';
        let note = '';
        let fulfillmentStatus = '備貨中';
        let paymentStatus = '未付款';
        let imageUrl = '';
        let promoSummary = '無優惠'; // 👈 新增：預設無優惠

        Object.keys(p).forEach(k => {
          const prop = p[k];
          if (!prop) return;
          const lowerKey = k.toLowerCase();

          if (prop.type === 'title' && prop.title?.[0]) {
            nickname = prop.title.map(t => t?.plain_text || '').join('');
          } else if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
            const textVal = prop.rich_text.map(t => t?.plain_text || '').join('');
            
            if (lowerKey.includes('暱稱') || lowerKey.includes('買家') || lowerKey.includes('name')) {
              nickname = textVal || nickname;
            } else if (lowerKey.includes('聯絡帳號') || lowerKey.includes('帳號') || lowerKey.includes('account')) {
              contactInfo = textVal;
            } else if (lowerKey.includes('聯絡方式') || lowerKey.includes('聯絡') || lowerKey.includes('id')) {
              if (!contactInfo) contactInfo = textVal;
            } else if (lowerKey.includes('商品') || lowerKey.includes('品項') || lowerKey === 'product') {
              product = textVal;
            } else if (lowerKey.includes('規格') || lowerKey.includes('款式') || lowerKey.includes('spec')) {
              if (textVal) spec = textVal.trim();
            } else if (lowerKey.includes('備註') || lowerKey.includes('note')) {
              note = textVal;
            } else if (lowerKey.includes('優惠') || lowerKey.includes('promo')) {
              // 🎯 核心：讀取 Notion 中的優惠活動欄位內容
              promoSummary = textVal || '無優惠';
            }
          } else if (prop.type === 'select' && prop.select?.name) {
            const selectVal = prop.select.name;
            if (lowerKey.includes('取貨') || lowerKey.includes('delivery')) delivery = selectVal;
            if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = selectVal;
            if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = selectVal;
            if (lowerKey.includes('規格') || lowerKey.includes('款式') || lowerKey.includes('spec')) spec = selectVal;
            if (lowerKey.includes('管道') || lowerKey.includes('channel')) contactChannel = selectVal;
          } else if (prop.type === 'status' && prop.status?.name) {
            const statusVal = prop.status.name;
            if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = statusVal;
            if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = statusVal;
          } else if (prop.type === 'number' && prop.number !== undefined) {
            if (lowerKey.includes('數量') || lowerKey.includes('quantity')) quantity = prop.number || 1;
            if (lowerKey.includes('總金額') || lowerKey.includes('總價') || lowerKey.includes('total') || lowerKey.includes('金額')) {
              totalPrice = prop.number || 0;
            }
          }
        });

        const cleanProduct = (product || '').trim();
        const cleanSpec = (spec || '').trim();

        const k1 = `${cleanProduct}_${cleanSpec}`;
        const k2 = `${cleanProduct}_標準款式`;
        const k3 = cleanSpec;
        const k4 = cleanProduct;

        if (productDict[k1]) imageUrl = productDict[k1];
        else if (productDict[k2]) imageUrl = productDict[k2];
        else if (productDict[k3]) imageUrl = productDict[k3];
        else if (productDict[k4]) imageUrl = productDict[k4];

        let fullContact = contactInfo;
        if (contactChannel && contactInfo && !contactInfo.includes(contactChannel)) {
          fullContact = `${contactChannel}: ${contactInfo}`;
        }

        const matchKeyword = keyword.toLowerCase();
        const matchName = nickname.toLowerCase().includes(matchKeyword);
        const matchContact = fullContact.toLowerCase().includes(matchKeyword);

        if (matchName || matchContact) {
          rawRows.push({
            nickname,
            contactInfo: fullContact,
            product: cleanProduct || '未命名商品',
            spec: cleanSpec,
            quantity,
            totalPrice,
            delivery,
            note,
            fulfillmentStatus,
            paymentStatus,
            imageUrl,
            promoRulesSummary: promoSummary, // 👈 傳給分組與前端
            createdAt: page.created_time ? page.created_time.substring(0, 16).replace('T', ' ') : ''
          });
        }
      });
    }

    // 依下單時間群組化
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

      // 🎯 將 promoRulesSummary 塞進品項陣列中
      groupedOrdersMap[timeKey].items.push({
        product: row.product,
        spec: row.spec,
        quantity: row.quantity,
        price: row.totalPrice,
        imageUrl: row.imageUrl,
        promoRulesSummary: row.promoRulesSummary // 👈 確保前端能讀到優惠內容
      });

      if (!row.paymentStatus.includes('已取消')) {
      groupedOrdersMap[timeKey].grandTotal += row.totalPrice;
      }

      if (!row.paymentStatus.includes('已付款') && !row.paymentStatus.includes('結清') && !row.paymentStatus.includes('已取消')) {
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
