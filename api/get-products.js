import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;       // 主商品表 A表 (若有設定)
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;                   // 款式明細表 C表

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 如果有 A 表，先建立 A 表 ID 與名稱的對照字典
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties || {};
          const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
          if (titleKey && p[titleKey]?.title?.[0]) {
            const name = p[titleKey].title.map(t => t?.plain_text || '').join('');
            if (name) aMapById[page.id] = name;
          }
        });
      } catch (e) {
        console.log('A表查詢警告:', e.message);
      }
    }

    // 2. 查詢 C表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties || {};

      // 🎯 狀態與已結單判斷 (支援 formula, status, select)
      let saleType = '預購'; 
      const statusKey = Object.keys(p).find(k => k && (k.includes('狀態') || p[k]?.type === 'formula' || p[k]?.type === 'status' || p[k]?.type === 'select'));
      
      if (statusKey && p[statusKey]) {
        const prop = p[statusKey];
        let statusVal = '';

        if (prop.type === 'formula') {
          if (prop.formula?.type === 'string') statusVal = prop.formula.string || '';
          else if (prop.formula?.type === 'number') statusVal = String(prop.formula.number || '');
        } else if (prop.type === 'status') {
          statusVal = prop.status?.name || '';
        } else if (prop.type === 'select') {
          statusVal = prop.select?.name || '';
        } else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
          statusVal = prop.rich_text.map(t => t?.plain_text || '').join('');
        }

        const trimmedVal = statusVal.trim();
        if (trimmedVal === '已結束' || trimmedVal === '已結單' || trimmedVal.includes('結束') || trimmedVal.includes('結單')) {
          saleType = '已結束';
        } else if (trimmedVal !== '') {
          saleType = trimmedVal;
        }
      }

      // 🎯 取得主商品名稱：優先從 Relation 關聯抓取 A 表名稱，若無則從 C 表文字欄位抓
      let productName = '';
      const relKey = Object.keys(p).find(k => k && p[k]?.type === 'relation');
      
      if (relKey && p[relKey]?.relation && p[relKey].relation.length > 0) {
        const relId = p[relKey].relation[0].id;
        productName = aMapById[relId] || '';
      }

      // 如果透過 Relation 沒抓到，改從 C 表內含有「商品」、「品名」、「名稱」或 title 屬性的欄位找
      if (!productName) {
        const prodKey = Object.keys(p).find(k => k && (k.includes('商品') || k.includes('品名') || k.includes('主商品') || p[k]?.type === 'title'));
        if (prodKey && p[prodKey]) {
          const prop = p[prodKey];
          if (prop.type === 'title' && Array.isArray(prop.title)) {
            productName = prop.title.map(t => t?.plain_text || '').join('');
          } else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
            productName = prop.rich_text.map(t => t?.plain_text || '').join('');
          } else if (prop.type === 'select') {
            productName = prop.select?.name || '';
          }
        }
      }

      if (!productName) productName = '未命名商品';

      // 🎯 取得款式名稱 (Spec / 款式 / 名稱，但排除主商品)
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => k && (k.includes('款式') || k.includes('Spec') || k.includes('規格')) && !k.includes('商品'));
      if (styleKey && p[styleKey]) {
        const prop = p[styleKey];
        if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
          styleName = prop.rich_text.map(t => t?.plain_text || '').join('') || '標準款式';
        } else if (prop.type === 'select') {
          styleName = prop.select?.name || '標準款式';
        } else if (prop.type === 'title' && Array.isArray(prop.title)) {
          styleName = prop.title.map(t => t?.plain_text || '').join('') || '標準款式';
        }
      }

      // 取得價格 (Number)
      let price = 0;
      const priceKey = Object.keys(p).find(k => k && (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k]?.type === 'number');
      if (priceKey && p[priceKey]) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => k && p[k]?.type === 'number');
        if (anyNumKey && p[anyNumKey]) price = p[anyNumKey].number || 0;
      }

      // 取得圖片 (Files)
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => k && (p[k]?.type === 'files' || k.includes('圖')));
      if (imgKey && p[imgKey]?.files && Array.isArray(p[imgKey].files) && p[imgKey].files.length > 0) {
        const fileObj = p[imgKey].files[0];
        if (fileObj) {
          imageUrl = fileObj.file?.url || fileObj.external?.url || '';
        }
      }

      // 分類
      let category = '全部';
      const catKey = Object.keys(p).find(k => k && (k.includes('地區') || k.includes('分類') || k.includes('Tag') || k.includes('分區')));
      if (catKey && p[catKey]) {
        const catProp = p[catKey];
        if (catProp.type === 'select') {
          category = catProp.select?.name || '全部';
        } else if (catProp.type === 'multi_select' && Array.isArray(catProp.multi_select) && catProp.multi_select.length > 0) {
          category = catProp.multi_select[0]?.name || '全部';
        } else if (catProp.type === 'rich_text' && Array.isArray(catProp.rich_text)) {
          category = catProp.rich_text.map(t => t?.plain_text || '').join('') || '全部';
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

    return res.status(200).json({ success: true, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
