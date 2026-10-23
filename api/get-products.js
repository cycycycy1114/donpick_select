import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;       // 主商品表 A表
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;                   // 款式明細表 C表
    const announcementDbId = process.env.ANNOUNCEMENT_DB_ID;

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 0. 抓取 Notion 公告
    let announcements = [];
    if (announcementDbId) {
      try {
        const annRes = await notion.databases.query({
          database_id: announcementDbId,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          page_size: 3
        });
        annRes.results.forEach(page => {
          const p = page.properties || {};
          const descKey = Object.keys(p).find(k => k.includes('內容') || k.includes('說明') || k.includes('公告') || p[k]?.type === 'rich_text');
          if (descKey && p[descKey]?.rich_text?.[0]) {
            const text = p[descKey].rich_text.map(t => t.plain_text).join('');
            if (text) announcements.push(text);
          }
        });
      } catch (err) {
        console.warn('公告讀取略過:', err.message);
      }
    }

    // 1. 查詢 A 表（主商品表），建立字典並過濾已結束商品
    let validAMap = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties || {};
          let isEnded = false;
          
          // 檢查 A 表狀態是否為已結束或斷貨
          const statusKey = Object.keys(p).find(k => k && (k.includes('狀態') || p[k]?.type === 'status' || p[k]?.type === 'select'));
          if (statusKey && p[statusKey]) {
            const prop = p[statusKey];
            let statusVal = '';
            if (prop.type === 'status') statusVal = prop.status?.name || '';
            else if (prop.type === 'select') statusVal = prop.select?.name || '';
            
            const trimmedVal = statusVal.trim();
            if (trimmedVal === '已結束' || trimmedVal === '已結單' || trimmedVal === '斷貨' || trimmedVal === '售完') {
              isEnded = true;
            }
          }

          if (!isEnded) {
            let name = '';
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title?.[0]) {
              name = p[titleKey].title.map(t => t.plain_text).join('');
            }

            if (name) {
              // 🎯 抓取 A 表的分類（支援 multi_select 或 select）
              let categories = ['伴手禮'];
              const catKey = Object.keys(p).find(k => k && (k.includes('分類') || k.includes('地區') || k.includes('Tag') || k.includes('分區')));
              if (catKey && p[catKey]) {
                const prop = p[catKey];
                if (prop.type === 'multi_select' && prop.multi_select?.length > 0) {
                  categories = prop.multi_select.map(item => item.name);
                } else if (prop.type === 'select' && prop.select?.name) {
                  categories = [prop.select.name];
                } else if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
                  const txt = prop.rich_text.map(t => t.plain_text).join('').trim();
                  if (txt) categories = [txt];
                }
              }

              // 抓取收單日
              let aDeadline = '';
              const dateKey = Object.keys(p).find(k => k && (k.includes('收單') || k.includes('日期') || k.includes('截止') || p[k]?.type === 'date'));
              if (dateKey && p[dateKey]?.date) {
                aDeadline = p[dateKey].date?.start || '';
              }

              // 抓取狀態類型（現貨/預購等）
              let saleType = '預購';
              const typeKey = Object.keys(p).find(k => k && (k.includes('類型') || k.includes('現貨')));
              if (typeKey && p[typeKey]?.type === 'select' && p[typeKey].select?.name) {
                saleType = p[typeKey].select.name;
              }

              validAMap[page.id] = {
                name,
                categories,
                deadline: aDeadline,
                saleType
              };
            }
          }
        });
      } catch (e) {
        console.warn('A表查詢略過或失敗:', e.message);
      }
    }

    // 2. 查詢 C 表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties || {};

      let parentInfo = null;
      const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
      
      if (relKey && p[relKey]?.relation?.length > 0) {
        const relId = p[relKey].relation[0].id;
        if (validAMap[relId]) {
          parentInfo = validAMap[relId];
        } else {
          return; // 若 A 表找不到或已結束，直接跳過此筆 C 表明細
        }
      } else {
        // 如果沒有 Relation，退回使用 C 表自身資料
        let fallbackName = '精選預購商品';
        const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
        if (titleKey && p[titleKey]?.title?.[0]) {
          fallbackName = p[titleKey].title.map(t => t.plain_text).join('') || '精選預購商品';
        }
        parentInfo = {
          name: fallbackName,
          categories: ['伴手禮'],
          deadline: '',
          saleType: '預購'
        };
      }

      // 🎯 抓取 C 表的款式名稱 (Title 屬性)
      let styleName = '標準款式';
      const styleTitleKey = Object.keys(p).find(k => p[k]?.type === 'title');
      if (styleTitleKey && p[styleTitleKey]?.title?.[0]) {
        styleName = p[styleTitleKey].title.map(t => t.plain_text).join('') || '標準款式';
      }

      // 抓取價格
      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k]?.type === 'number');
      if (priceKey && p[priceKey]?.number !== undefined) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => p[k]?.type === 'number');
        if (anyNumKey && p[anyNumKey]?.number !== undefined) price = p[anyNumKey].number || 0;
      }

      // 抓取圖片
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => p[k]?.type === 'files' || k.includes('圖'));
      if (imgKey && p[imgKey]?.files?.[0]) {
        const fileObj = imgKey.files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      products.push({
        productName: parentInfo.name,
        categories: parentInfo.categories,
        saleType: parentInfo.saleType,
        deadline: parentInfo.deadline,
        styleName: styleName,
        price: price,
        imageUrl: imageUrl
      });
    });

    return res.status(200).json({ success: true, announcements, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
