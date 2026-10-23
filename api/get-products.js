import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID || process.env.DATABASE_ID;                   
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

    // 1. 查詢 C 表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties || {};

      // 抓取狀態（預購、現貨、已結束、斷貨等）
      let saleType = '預購'; 
      const statusKey = Object.keys(p).find(k => k && (k.includes('狀態') || p[k]?.type === 'status' || p[k]?.type === 'select'));
      if (statusKey && p[statusKey]) {
        const prop = p[statusKey];
        let statusVal = '';
        if (prop.type === 'status') statusVal = prop.status?.name || '';
        else if (prop.type === 'select') statusVal = prop.select?.name || '';
        else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
          statusVal = prop.rich_text.map(t => t?.plain_text || '').join('');
        }

        const trimmedVal = statusVal.trim();
        if (trimmedVal === '已結束' || trimmedVal === '已結單' || trimmedVal === '斷貨' || trimmedVal === '售完') {
          saleType = '已結束';
        } else if (trimmedVal !== '') {
          saleType = trimmedVal;
        }
      }

      // 取得主商品名稱
      let productName = '精選商品';
      const prodKey = Object.keys(p).find(k => k && (k.includes('商品') || k.includes('品名') || k.includes('名稱') || p[k]?.type === 'title'));
      if (prodKey && p[prodKey]) {
        const prop = p[prodKey];
        if (prop.type === 'title' && Array.isArray(prop.title)) {
          productName = prop.title.map(t => t?.plain_text || '').join('') || '精選商品';
        } else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
          productName = prop.rich_text.map(t => t?.plain_text || '').join('') || '精選商品';
        } else if (prop.type === 'select') {
          productName = prop.select?.name || '精選商品';
        }
      }

      // 取得款式名稱
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => k && (k.includes('款式') || k.includes('Spec') || (p[k]?.type === 'rich_text' && !k.includes('商品'))));
      if (styleKey && p[styleKey]) {
        const prop = p[styleKey];
        if (prop.type === 'title' && Array.isArray(prop.title)) {
          styleName = prop.title.map(t => t?.plain_text || '').join('') || '標準款式';
        } else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
          styleName = prop.rich_text.map(t => t?.plain_text || '').join('') || '標準款式';
        }
      }

      // 取得價格
      let price = 0;
      const priceKey = Object.keys(p).find(k => k && (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k]?.type === 'number');
      if (priceKey && p[priceKey]) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => k && p[k]?.type === 'number');
        if (anyNumKey && p[anyNumKey]) price = p[anyNumKey].number || 0;
      }

      // 取得圖片
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => k && (p[k]?.type === 'files' || k.includes('圖')));
      if (imgKey && p[imgKey]?.files && Array.isArray(p[imgKey].files) && p[imgKey].files.length > 0) {
        const fileObj = imgKey.files[0];
        if (fileObj) {
          imageUrl = fileObj.file?.url || fileObj.external?.url || '';
        }
      }

      // 🎯 修正分類抓取邏輯：確實去抓 Notion 裡的分類、地區或 Tag 欄位（如果找不到則給予合適的預設值，例如 '伴手禮' 或 '其他'，絕對不給 '全部'）
      let category = '伴手禮';
      const catKey = Object.keys(p).find(k => k && (k.includes('地區') || k.includes('分類') || k.includes('Tag') || k.includes('分區')));
      if (catKey && p[catKey]) {
        const catProp = p[catKey];
        if (catProp.type === 'select' && catProp.select?.name) {
          category = catProp.select.name;
        } else if (catProp.type === 'multi_select' && Array.isArray(catProp.multi_select) && catProp.multi_select.length > 0) {
          category = catProp.multi_select[0]?.name || '伴手禮';
        } else if (catProp.type === 'rich_text' && Array.isArray(catProp.rich_text)) {
          const txt = catProp.rich_text.map(t => t?.plain_text || '').join('').trim();
          if (txt) category = txt;
        }
      }

      // 收單日期
      let deadline = '';
      const dateKey = Object.keys(p).find(k => k && (k.includes('收單') || k.includes('日期') || k.includes('截止') || p[k]?.type === 'date'));
      if (dateKey && p[dateKey]?.date) {
        deadline = p[dateKey].date?.start || '';
      }

      products.push({
        productName: productName,
        styleName: styleName,
        price: price,
        imageUrl: imageUrl,
        category: category,
        deadline: deadline,
        saleType: saleType
      });
    });

    return res.status(200).json({ success: true, announcements, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
