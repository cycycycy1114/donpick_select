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

    // 1. 建立商品 C 表的圖片與規格對照字典
    let productDict = {};
    if (productDetailDbId) {
      try {
        const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
        cRes.results.forEach(page => {
          const p = page.properties || {};
          
          let styleName = '';
          const titleKey = Object.keys(p).find(k => p[k].type === 'title');
          if (titleKey && p[titleKey]?.title?.[0]) {
            styleName = p[titleKey].title.map(t => t.plain_text).join('').trim();
          }

          let imageUrl = '';
          const imgKey = Object.keys(p).find(k => p[k].type === 'files');
          if (imgKey && p[imgKey]?.files?.[0]) {
            const fileObj = p[imgKey].files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }

          if (styleName) {
            productDict[styleName] = imageUrl;
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
          } else if (lowerKey.includes('備註') || lowerKey.includes('note')) {
            note = textVal;
          }
        } else if (prop.type === 'select' && prop.select?.name) {
          const selectVal = prop.select.name;
          if (lowerKey.includes('取貨') || lowerKey.includes('delivery')) delivery = selectVal;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = selectVal;
          if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = selectVal;
        } else if (prop.type === 'status' && prop.status?.name) {
          const statusVal = prop.status.name;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = statusVal;
          if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = statusVal;
        } else if (prop.type === 'number') {
          if (lowerKey.includes('數量') || lowerKey.includes('quantity')) quantity = prop.number || 1;
          if (lowerKey.includes('總金額') || lowerKey.includes('總價') || lowerKey.includes('total')) totalPrice = prop.number || 0;
        } else if (prop.type === 'files') {
          if (prop.files?.[0]) {
            const fileObj = prop.files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }
        }
      });

      // 自動從商品字典對應圖片
      if (!imageUrl && productDict[spec]) {
        imageUrl = productDict[spec];
      } else if (!imageUrl && productDict[product]) {
        imageUrl = productDict[product];
      }

      const matchKeyword = keyword.toLowerCase();
      const matchName = nickname.toLowerCase().includes(matchKeyword);
      const matchContact = contactInfo.toLowerCase().includes(matchKeyword);

      if (matchName || matchContact) {
        rawRows.push({
          nickname,
          contactInfo,
          product: product || '未命名商品',
          spec: spec || '標準款式',
          quantity,
          totalPrice,
          delivery,
          note,
          fulfillmentStatus,
          paymentStatus,
          imageUrl,
          createdAt: page.created_time ? page.created_time.substring(0, 16).replace('T', ' ') : ''
        });
      }
    });

    return res.status(200).json({ success: true, orders: rawRows });

  } catch (error) {
    console.error("Query Orders Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
```[cite: 1]

---

### 📄 3. 更新前端查單顯示區塊：`index.html` 中的 `searchOrders()` 函式
請確認您的 `index.html` 裡的 `searchOrders()` 有包含顯示圖片的程式碼（如下方範例）：

```javascript
    window.searchOrders = async function() {
      const keyword = document.getElementById('queryKeyword').value.trim();
      const container = document.getElementById('queryResultContainer');
      if (!keyword) { alert("請輸入查詢暱稱！"); return; }

      container.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">⏳ 查詢中...</div>';
      try {
        const res = await fetch(`/api/get-orders?keyword=${encodeURIComponent(keyword)}`);
        const data = await res.json();
        
        if (data.success && data.orders && data.orders.length > 0) {
          let html = `<div style="font-size: 13px; font-weight: bold; margin-bottom: 8px; color: #333;">找到 ${data.orders.length} 筆相關訂單：</div>`;

          data.orders.forEach(ord => {
            const imgTag = ord.imageUrl 
              ? `<img src="${ord.imageUrl}" style="width: 45px; height: 45px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd;">` 
              : `<div style="width: 45px; height: 45px; background: #eee; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #999;">無圖</div>`;

            html += `
              <div style="background:#fff; border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:12px; font-size:13px; line-height: 1.5;">
                <div style="display:flex; justify-content:space-between; font-weight:bold; color:var(--milk-red); margin-bottom:6px; border-bottom:1px dashed #eee; padding-bottom:6px;">
                  <span>👤 ${ord.nickname} (${ord.contactInfo})</span>
                  <span>📅 ${ord.createdAt}</span>
                </div>
                <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 6px;">
                  ${imgTag}
                  <div>
                    <strong>📦 品項：</strong>${ord.product} / <strong>規格：</strong>${ord.spec} x ${ord.quantity}<br>
                    <strong>💰 金額：</strong>$${ord.totalPrice} | <strong>取貨：</strong>${ord.delivery}
                  </div>
                </div>
                <div><strong>狀態：</strong><span style="color: #d46b08; font-weight: bold;">[${ord.fulfillmentStatus}]</span> / <span style="color: #52c41a; font-weight: bold;">[${ord.paymentStatus}]</span></div>
                ${ord.note ? `<div style="color: #666; margin-top: 4px;"><strong>📝 備註：</strong>${ord.note}</div>` : ''}
              </div>
            `;
          });

          container.innerHTML = html;
        } else {
          container.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">查無相關訂單紀錄</div>';
        }
      } catch (e) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">❌ 查詢發生錯誤</div>';
      }
    };
