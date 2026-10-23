import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;       
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;                   
    const annDbId = process.env.ANNOUNCEMENT_DATABASE_ID || process.env.ANNOUNCEMENT_DB_ID;

    if (!productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 PRODUCT_DETAIL_DB_ID 環境變數' });
    }

    // 1. 查詢 A表 (主商品表)，建立 A 表資料字典（抓取分類、說明、收單日）
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId, page_size: 100 });
        aRes.results.forEach(page => {
          const p = page.properties || {};
          let productName = '';
          const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
          if (titleKey && p[titleKey]?.title?.length > 0) {
            productName = p[titleKey].title.map(t => t.plain_text || '').join('');
          }
          if (!productName) return;

          // 抓取 A 表的商品說明/內容介紹
          let description = '';
          const descKey = Object.keys(p).find(k => (k.includes('說明') || k.includes('介紹') || k.includes('備註') || k.includes('內容')) && p[k]?.type === 'rich_text');
          if (descKey && p[descKey]?.rich_text?.length > 0) {
            description = p[descKey].rich_text.map(t => t.plain_text || '').join('');
          }

          // 抓取收單日
          let deadline = '';
          const dateKey = Object.keys(p).find(k => (k.includes('收單') || k.includes('截止') || k.includes('日期')) && p[k]?.type === 'date');
          if (dateKey && p[dateKey]?.date?.start) {
            deadline = p[dateKey].date.start;
          }

          // 抓取分類
          let categories = ['全部'];
          const catKey = Object.keys(p).find(k => k.includes('分類') || k.includes('地區') || k.includes('category'));
          if (catKey && p[catKey]) {
            if (p[catKey].type === 'multi_select') {
              categories = p[catKey].multi_select.map(m => m.name).filter(Boolean);
            } else if (p[catKey].type === 'select') {
              categories = [p[catKey].select.name];
            }
          }

          aMapById[page.id] = { productName, description, deadline, categories };
        });
      } catch (e) {
        console.log("A表查詢略過或失敗:", e.message);
      }
    }

    // 2. 查詢 C表 (款式明細表)
    const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties || {};

      let styleName = '標準款式';
      const styleTitleKey = Object.keys(p).find(k => p[k]?.type === 'title');
      if (styleTitleKey && p[styleTitleKey]?.title?.[0]) {
        styleName = p[styleTitleKey].title.map(t => t.plain_text || '').join('') || '標準款式';
      }

      let parentData = null;
      const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
      if (relKey && p[relKey]?.relation?.length > 0) {
        const parentId = p[relKey].relation[0].id;
        parentData = aMapById[parentId];
      }

      // 若無關聯 A 表，給予預設值
      if (!parentData) {
        parentData = {
          productName: '精選商品',
          description: '',
          deadline: '',
          categories: ['全部']
        };
      }

      // 取得價格
      let price = 0;
      const priceKeys = Object.keys(p).filter(k => p[k]?.type === 'number');
      if (priceKeys.length > 0) {
        const preferredPriceKey = priceKeys.find(k => k.includes('價') || k.includes('price') || k.includes('NT') || k.includes('金額')) || priceKeys[0];
        price = p[preferredPriceKey]?.number || 0;
      }

      // 取得圖片
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => p[k]?.type === 'files');
      if (imgKey && p[imgKey]?.files?.length > 0) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      // 取得狀態
      let saleType = '預購';
      const typeKey = Object.keys(p).find(k => k.includes('狀態') || k.includes('saleType') || k.includes('type'));
      if (typeKey && p[typeKey]) {
        if (p[typeKey].type === 'select' && p[typeKey].select?.name) {
          saleType = p[typeKey].select.name;
        } else if (p[typeKey].type === 'status' && p[typeKey].status?.name) {
          saleType = p[typeKey].status.name;
        } else if (p[typeKey].type === 'formula') {
          saleType = p[typeKey].formula?.string || p[typeKey].formula?.boolean?.toString() || '預購';
        } else if (p[typeKey].type === 'rich_text' && p[typeKey].rich_text) {
          saleType = p[typeKey].rich_text.map(t => t.plain_text || '').join('') || '預購';
        }
      }

      products.push({
        productName: parentData.productName,
        styleName,
        price,
        saleType,
        categories: parentData.categories,
        imageUrl,
        deadline: parentData.deadline,
        description: parentData.description, // 傳遞 A 表的商品介紹
        needDeposit: false
      });
    });

    // 3. 查詢公告欄資料庫
    let announcements = [];
    if (annDbId) {
      try {
        const annRes = await notion.databases.query({ database_id: annDbId, page_size: 10 });
        announcements = annRes.results.map(page => {
          const p = page.properties || {};
          let isHidden = false;
          const statusKey = Object.keys(p).find(k => k.includes('狀態') || k.includes('status') || p[k]?.type === 'status' || p[k]?.type === 'select');
          if (statusKey && p[statusKey]) {
            const val = p[statusKey].status?.name || p[statusKey].select?.name || '';
            if (val === '隱藏' || val === '關閉' || val === '下架' || val === 'false') isHidden = true;
          }
          if (isHidden) return null;

          let contentText = '';
          const contentKey = Object.keys(p).find(k => (k.includes('內容') || k.includes('說明') || k.includes('公告')) && p[k]?.type === 'rich_text');
          if (contentKey && p[contentKey]?.rich_text?.length > 0) {
            contentText = p[contentKey].rich_text.map(t => t.plain_text || '').join('');
          }
          if (!contentText) {
            Object.keys(p).forEach(k => {
              const prop = p[k];
              if (!contentText && prop?.type === 'rich_text' && prop.rich_text?.length > 0) {
                contentText = prop.rich_text.map(t => t.plain_text || '').join('');
              } else if (!contentText && prop?.type === 'title' && prop.title?.length > 0) {
                contentText = prop.title.map(t => t.plain_text || '').join('');
              }
            });
          }
          return contentText;
        }).filter(Boolean);
      } catch (e) {}
    }

    return res.status(200).json({ success: true, products, announcements });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
