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

    // 1. 查詢 A 表 (主商品表)，建立 A 表名稱字典
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

          let description = '';
          const descKey = Object.keys(p).find(k => (k.includes('說明') || k.includes('介紹') || k.includes('備註') || k.includes('內容')) && p[k]?.type === 'rich_text');
          if (descKey && p[descKey]?.rich_text?.length > 0) {
            description = p[descKey].rich_text.map(t => t.plain_text || '').join('');
          }

          let deadline = '';
          const dateKey = Object.keys(p).find(k => (k.includes('收單') || k.includes('截止') || k.includes('日期')) && p[k]?.type === 'date');
          if (dateKey && p[dateKey]?.date?.start) {
            deadline = p[dateKey].date.start;
          }

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

    // 2. 查詢 C 表 (款式明細表)
    const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties || {};

      // 🎯 【關鍵修復】款式名稱：絕對鎖定 C 表中 type === 'title' 的欄位！
      let styleName = '標準款式';
      const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
      if (titleKey && p[titleKey]?.title?.[0]) {
        styleName = p[titleKey].title.map(t => t.plain_text || '').join('').trim() || '標準款式';
      }

      // 取得主商品名稱（透過 Relation 對應 A 表，若無則從 C 表文字欄位抓）
      let parentData = null;
      const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
      if (relKey && p[relKey]?.relation?.length > 0) {
        const parentId = p[relKey].relation[0].id;
        parentData = aMapById[parentId];
      }

      if (!parentData) {
        let fallbackName = '精選商品';
        const prodNameKey = Object.keys(p).find(k => (k.includes('商品') || k.includes('品名') || k.includes('名稱')) && p[k]?.type === 'rich_text');
        if (prodNameKey && p[prodNameKey]?.rich_text?.[0]) {
          fallbackName = p[prodNameKey].rich_text.map(t => t.plain_text || '').join('').trim();
        }
        parentData = {
          productName: fallbackName,
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
        const fileObj = imgKey.files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      // 取得狀態 (支援 status, select, formula)
      let saleType = '預購';
      const statusKey = Object.keys(p).find(k => k && (k.includes('狀態') || p[k]?.type === 'status' || p[k]?.type === 'select' || p[k]?.type === 'formula'));
      if (statusKey && p[statusKey]) {
        const prop = p[statusKey];
        let statusVal = '';
        if (prop.type === 'status') statusVal = prop.status?.name || '';
        else if (prop.type === 'select') statusVal = prop.select?.name || '';
        else if (prop.type === 'rich_text') statusVal = prop.rich_text.map(t => t?.plain_text || '').join('');
        else if (prop.type === 'formula') {
          statusVal = prop.formula?.string || prop.formula?.boolean?.toString() || String(prop.formula?.number ?? '');
        }

        const rawLower = String(statusVal).trim().toLowerCase();
        if (rawLower.includes('結束') || rawLower.includes('結單') || rawLower.includes('斷貨') || rawLower.includes('售完') || rawLower.includes('下架') || rawLower === 'false') {
          saleType = '已結束';
        } else if (rawLower !== '') {
          saleType = statusVal.trim();
        }
      }

      products.push({
        productName: parentData.productName,
        styleName, // 🎯 正確對應 C 表的 Title 款式名稱
        price,
        saleType,
        categories: parentData.categories,
        imageUrl,
        deadline: parentData.deadline,
        description: parentData.description,
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
