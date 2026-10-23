import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID || process.env.DATABASE_ID;                   
    const annDbId = process.env.ANNOUNCEMENT_DATABASE_ID || process.env.ANNOUNCEMENT_DB_ID;

    if (!productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 PRODUCT_DETAIL_DB_ID 環境變數' });
    }

    // 1. 直接查詢 C 表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties || {};

      // 🎯 嚴格以 C 表的狀態欄位為主 (支援 status, select, formula, rich_text)
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
          saleType = statusVal.trim(); // 保留 C 表原本寫的狀態（如：現貨、預購等）
        }
      }

      // 2. 取得主商品名稱
      let productName = '精選商品';
      const prodKey = Object.keys(p).find(k => k && (k.includes('商品') || k.includes('品名') || k.includes('名稱') || p[k]?.type === 'title'));
      if (prodKey && p[prodKey]) {
        const prop = p[prodKey];
        if (prop.type === 'title') productName = prop.title.map(t => t?.plain_text || '').join('') || '精選商品';
        else if (prop.type === 'rich_text') productName = prop.rich_text.map(t => t?.plain_text || '').join('') || '精選商品';
        else if (prop.type === 'select') productName = prop.select?.name || '精選商品';
      }

      // 3. 取得款式名稱
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => k && (k.includes('款式') || k.includes('Spec') || (p[k]?.type === 'rich_text' && !k.includes('商品'))));
      if (styleKey && p[styleKey]) {
        const prop = p[styleKey];
        if (prop.type === 'title') styleName = prop.title.map(t => t?.plain_text || '').join('') || '標準款式';
        else if (prop.type === 'rich_text') styleName = prop.rich_text.map(t => t?.plain_text || '').join('') || '標準款式';
      }

      // 4. 取得價格 (Number)
      let price = 0;
      const priceKeys = Object.keys(p).filter(k => p[k]?.type === 'number');
      if (priceKeys.length > 0) {
        const preferredPriceKey = priceKeys.find(k => k.includes('價') || k.includes('price') || k.includes('NT') || k.includes('金額')) || priceKeys[0];
        price = p[preferredPriceKey]?.number || 0;
      }

      // 5. 取得圖片 (Files)
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => k && (p[k]?.type === 'files' || k.includes('圖')));
      if (imgKey && p[imgKey]?.files?.length > 0) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      // 6. 分類
      let categories = ['全部'];
      const catKey = Object.keys(p).find(k => k && (k.includes('地區') || k.includes('分類') || k.includes('Tag') || k.includes('分區')));
      if (catKey && p[catKey]) {
        const catProp = p[catKey];
        if (catProp.type === 'select') categories = [catProp.select.name];
        else if (catProp.type === 'multi_select') categories = catProp.multi_select.map(m => m.name).filter(Boolean);
        else if (catProp.type === 'rich_text') {
          const txt = catProp.rich_text.map(t => t?.plain_text || '').join('').trim();
          if (txt) categories = [txt];
        }
      }
      if (categories.length === 0) categories = ['全部'];

      // 7. 收單日期
      let deadline = '';
      const dateKey = Object.keys(p).find(k => k && (k.includes('收單') || k.includes('日期') || k.includes('截止') || p[k]?.type === 'date'));
      if (dateKey && p[dateKey]?.date?.start) {
        deadline = p[dateKey].date.start;
      }

      // 8. 商品介紹
      let description = '';
      const descKey = Object.keys(p).find(k => k && (k.includes('說明') || k.includes('介紹') || k.includes('備註') || k.includes('內容')) && p[k]?.type === 'rich_text');
      if (descKey && p[descKey]?.rich_text?.length > 0) {
        description = p[descKey].rich_text.map(t => t.plain_text || '').join('');
      }

      products.push({
        productName,
        styleName,
        price,
        saleType, // 🎯 直接採用 C 表的狀態
        categories,
        imageUrl,
        deadline,
        description,
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
