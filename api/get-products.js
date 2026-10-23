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
    const announcementDbId = process.env.ANNOUNCEMENT_DB_ID;                      // 📢 公告資料庫 ID

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 0. 抓取 Notion 公告 (最近 3 筆，自動支援隱藏狀態判斷)
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
          const statusKey = Object.keys(p).find(k => k.includes('狀態') || p[k]?.type === 'status' || p[k]?.type === 'select');
          let isHidden = false;
          if (statusKey && p[statusKey]) {
            const val = p[statusKey].status?.name || p[statusKey].select?.name || '';
            if (val === '隱藏' || val === '關閉' || val === '下架') isHidden = true;
          }

          if (!isHidden) {
            const descKey = Object.keys(p).find(k => k.includes('內容') || k.includes('說明') || k.includes('公告') || p[k]?.type === 'rich_text');
            if (descKey && p[descKey]?.rich_text?.[0]) {
              const text = p[descKey].rich_text.map(t => t.plain_text).join('');
              if (text) announcements.push(text);
            }
          }
        });
      } catch (err) {
        console.warn('公告讀取略過或失敗:', err.message);
      }
    }

    // 1. 查詢 A表（主商品表）建立字典
    let validAMap = {}; 
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties || {};
          let isEnded = false;
          
          const statusKey = Object.keys(p).find(k => p[k]?.type === 'status' || k.includes('狀態'));
          if (statusKey && p[statusKey]?.status) {
            const statusVal = p[statusKey].status.name || '';
            if (statusVal.trim() === '已結束') isEnded = true;
          }

          if (!isEnded) {
            let name = '';
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title?.[0]) {
              name = p[titleKey].title.map(t => t.plain_text).join('');
            }

            if (name) {
              let categories = ['伴手禮'];
              const catKey = Object.keys(p).find(k => k.includes('分類') || k.includes('地區') || k.includes('Tag') || p[k]?.type === 'multi_select');
              if (catKey && p[catKey]) {
                const prop = p[catKey];
                if (prop.type === 'multi_select' && prop.multi_select?.length > 0) {
                  categories = prop.multi_select.map(item => item.name);
                } else if (prop.type === 'select' && prop.select?.name) {
                  categories = [prop.select.name];
                }
              }

              let description = '';
              const descKey = Object.keys(p).find(k => k.includes('內容介紹') || k.includes('介紹') || k.includes('說明'));
              if (descKey && p[descKey]?.rich_text?.[0]) {
                description = descKey.rich_text.map(t => t.plain_text).join('');
              }

              let aDeadline = '';
              const dateKey = Object.keys(p).find(k => (k.includes('收單') || k.includes('日期') || k.includes('截止') || p[k]?.type === 'date'));
              if (dateKey && p[dateKey]?.date && typeof p[dateKey].date === 'object' && p[dateKey].date.start) {
                aDeadline = p[dateKey].date.start;
              }

              let needDeposit = false;
              const depositKey = Object.keys(p).find(k => k.includes('訂金') || k.includes('押金'));
              if (depositKey && p[depositKey]) {
                const prop = p[depositKey];
                if (prop.type === 'checkbox') needDeposit = prop.checkbox;
                if (prop.type === 'select' && (prop.select?.name === '是' || prop.select?.name === '需訂金')) needDeposit = true;
              }

              validAMap[page.id] = {
                name,
                categories,
                description,
                deadline: aDeadline,
                needDeposit
              };
            }
          }
        });
      } catch (e) {
        console.warn('A表查詢略過或失敗:', e.message);
      }
    }

    // 2. 查詢 C表（款式明細表）
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
        }
      }

      if (!parentInfo) {
        let fallbackName = '精選預購商品';
        const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
        if (titleKey && p[titleKey]?.title?.[0]) {
          fallbackName = p[titleKey].title.map(t => t.plain_text).join('') || '精選預購商品';
        }
        parentInfo = {
          name: fallbackName,
          categories: ['伴手禮'],
          description: '',
          deadline: '',
          needDeposit: false
        };
      }

      let styleName = '標準款式';
      const styleTitleKey = Object.keys(p).find(k => p[k]?.type === 'title');
      if (styleTitleKey && p[styleTitleKey]?.title?.[0]) {
        styleName = p[styleTitleKey].title.map(t => t.plain_text).join('') || '標準款式';
      }

      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k]?.type === 'number');
      if (priceKey && p[priceKey]?.number !== undefined) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => p[k]?.type === 'number');
        if (anyNumKey && p[anyNumKey]?.number !== undefined) price = p[anyNumKey].number || 0;
      }

      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => p[k]?.type === 'files' || k.includes('圖'));
      if (imgKey && p[imgKey]?.files?.[0]) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      products.push({
        productName: parentInfo.name,
        categories: parentInfo.categories,
        description: parentInfo.description,
        saleType: '預購',
        deadline: parentInfo.deadline,
        needDeposit: parentInfo.needDeposit,
        styleName: styleName,
        price: price,
        imageUrl: imageUrl
      });
    });

    return res.status(200).json({ 
      success: true, 
      announcements: announcements, // 📢 回傳公告資料
      products 
    });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
