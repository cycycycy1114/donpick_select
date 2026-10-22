import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID || process.env.DATABASE_ID;                   

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      let saleType = '預購'; 
      let isEnded = false;

      const statusKey = Object.keys(p).find(k => k.includes('狀態') || p[k].type === 'status' || p[k].type === 'select');
      if (statusKey) {
        const prop = p[statusKey];
        let statusVal = '';
        if (prop.type === 'status') statusVal = prop.status?.name || '';
        else if (prop.type === 'select') statusVal = prop.select?.name || '';
        else if (prop.type === 'rich_text') statusVal = prop.rich_text.map(t => t.plain_text).join('') || '';

        if (statusVal.trim() === '已結束') {
          isEnded = true;
          saleType = '已結束';
        } else if (statusVal.trim() !== '') {
          saleType = statusVal.trim();
        }
      }

      const typeKey = Object.keys(p).find(k => k.includes('類型') || k.includes('現貨') || k.includes('預購'));
      if (typeKey && p[typeKey]) {
        const prop = p[typeKey];
        if (prop.type === 'select' && prop.select?.name) {
          saleType = prop.select.name;
        } else if (prop.type === 'status' && prop.status?.name) {
          saleType = prop.status.name;
        }
      }
      if (isEnded) saleType = '已結束'; // 強制確保已結束標籤

      let productName = '精選商品';
      const prodKey = Object.keys(p).find(k => k.includes('商品') || k.includes('品名') || k.includes('名稱') || p[k].type === 'title');
      if (prodKey) {
        const prop = p[prodKey];
        if (prop.type === 'title') productName = prop.title.map(t => t.plain_text).join('') || '精選商品';
        else if (prop.type === 'rich_text') productName = prop.rich_text.map(t => t.plain_text).join('') || '精選商品';
        else if (prop.type === 'select') productName = prop.select?.name || '精選商品';
      }

      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => k.includes('款式') || k.includes('Spec') || (p[k].type === 'rich_text' && !k.includes('商品')));
      if (styleKey && p[styleKey]) {
        const prop = p[styleKey];
        if (prop.type === 'title') styleName = prop.title.map(t => t.plain_text).join('') || '標準款式';
        else if (prop.type === 'rich_text') styleName = prop.rich_text.map(t => t.plain_text).join('') || '標準款式';
      }

      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k].type === 'number');
      if (priceKey) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => k[k].type === 'number');
        if (anyNumKey) price = p[anyNumKey].number || 0;
      }

      const imgKey = Object.keys(p).find(k => p[k].type === 'files' || k.includes('圖'));
      let imageUrl = '';
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = imgKey.files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      let category = '全部';
      const catKey = Object.keys(p).find(k => k.includes('地區') || k.includes('分類') || k.includes('Tag') || k.includes('分區'));
      if (catKey) {
        const catProp = p[catKey];
        if (catProp.type === 'select') category = catProp.select?.name || '全部';
        else if (catProp.type === 'multi_select' && catProp.multi_select.length > 0) category = catProp.multi_select[0].name || '全部';
        else if (catProp.type === 'rich_text') category = catProp.rich_text.map(t => t.plain_text).join('') || '全部';
      }

      let deadline = '';
      const dateKey = Object.keys(p).find(k => (k.includes('收單') || k.includes('日期') || k.includes('截止') || p[k].type === 'date'));
      if (dateKey && p[dateKey]?.date) {
        deadline = p[dateKey].date.start || '';
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
