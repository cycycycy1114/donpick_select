import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;       // A表 (主商品表) ID
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;                   // C表 (款式明細表) ID
    const annDbId = process.env.ANNOUNCEMENT_DATABASE_ID;                         // 公告表 ID (選填)

    if (!productDbId || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定完整的 PRODUCT_DB_ID 或 PRODUCT_DETAIL_DB_ID 環境變數' });
    }

    // 1. 查詢 A表 (主商品表)，建立 A表資料的字典 (對應 ID -> 屬性)
    const aRes = await notion.databases.query({ database_id: productDbId, page_size: 100 });
    let aMapById = {};

    aRes.results.forEach(page => {
      const p = page.properties;
      
      // 取得 A表的主商品名稱 (Title)
      let productName = '';
      const titleKey = Object.keys(p).find(k => p[k].type === 'title');
      if (titleKey && p[titleKey].title?.[0]) {
        productName = p[titleKey].title.map(t => t.plain_text).join('');
      }

      if (!productName) return;

      // 取得 A表的分類 (Multi-select 或 Select)
      let categories = ['全部'];
      const catKey = Object.keys(p).find(k => k.includes('分類') || k.includes('地區') || k.includes('category') || p[k].type === 'multi_select' || p[k].type === 'select');
      if (catKey) {
        if (p[catKey].type === 'multi_select') {
          categories = p[catKey].multi_select.map(m => m.name);
        } else if (p[catKey].type === 'select' && p[catKey].select?.name) {
          categories = [p[catKey].select.name];
        }
      }

      // 取得 A表的狀態 (Select 或 Status)
      let saleType = '預購';
      const typeKey = Object.keys(p).find(k => k.includes('狀態') || k.includes('saleType') || k.includes('type') || p[k].type === 'select' || p[k].type === 'status');
      if (typeKey) {
        if (p[typeKey].type === 'select' && p[typeKey].select?.name) {
          saleType = p[typeKey].select.name;
        } else if (p[typeKey].type === 'status' && p[typeKey].status?.name) {
          saleType = p[typeKey].status.name;
        }
      }

      // 取得 A表的收單日 (Date)
      let deadline = '';
      const dateKey = Object.keys(p).find(k => k.includes('收單') || k.includes('截止') || k.includes('deadline') || p[k].type === 'date');
      if (dateKey && p[dateKey].date?.start) {
        deadline = p[dateKey].date.start;
      }

      // 取得 A表是否需訂金 (Checkbox)
      let needDeposit = false;
      const depositKey = Object.keys(p).find(k => k.includes('訂金') || k.includes('deposit') || p[k].type === 'checkbox');
      if (depositKey) {
        needDeposit = !!p[depositKey].checkbox;
      }

      // 取得 A表的商品說明 (Rich text)
      let description = '';
      const descKey = Object.keys(p).find(k => k.includes('說明') || k.includes('備註') || k.includes('desc') || p[k].type === 'rich_text');
      if (descKey && p[descKey].rich_text?.[0]) {
        description = p[descKey].rich_text.map(t => t.plain_text).join('');
      }

      aMapById[page.id] = {
        productName,
        categories: categories.length > 0 ? categories : ['全部'],
        saleType,
        deadline,
        needDeposit,
        description
      };
    });

    // 2. 查詢 C表 (款式明細表)，透過 Relation 對應回 A表
    const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      // 取得 C表的款式名稱 (Title 或 Rich text)
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => p[k].type === 'title' || k.includes('款式') || k.includes('規格'));
      if (styleKey) {
        if (p[styleKey].type === 'title') {
          styleName = p[styleKey].title.map(t => t.plain_text).join('') || '標準款式';
        } else if (p[styleKey].type === 'rich_text') {
          styleName = p[styleKey].rich_text.map(t => t.plain_text).join('') || '標準款式';
        }
      }

      // 尋找 C表指向 A表的關聯欄位 (Relation)
      let parentData = null;
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      if (relKey && p[relKey].relation.length > 0) {
        const parentId = p[relKey].relation[0].id;
        parentData = aMapById[parentId];
      }

      // 如果沒有透過 Relation，試著看 C表有沒有直接寫商品名稱的欄位作為備用
      if (!parentData) {
        const directNameKey = Object.keys(p).find(k => (k.includes('商品') || k.includes('品名')) && p[k].type === 'rich_text');
        if (directNameKey && p[directNameKey].rich_text?.[0]) {
          const directName = p[directNameKey].rich_text.map(t => t.plain_text).join('');
          // 如果 A表剛好有同名的項目，直接借用
          const matchedKey = Object.keys(aMapById).find(k => aMapById[k].productName === directName);
          if (matchedKey) parentData = aMapById[matchedKey];
        }
      }

      // 如果依然找不到關聯主商品，給予預設值避免漏掉
      if (!parentData) {
        parentData = {
          productName: '精選商品',
          categories: ['全部'],
          saleType: '預購',
          deadline: '',
          needDeposit: false,
          description: ''
        };
      }

      // 取得 C表的價格 (Number)
      const priceKey = Object.keys(p).find(k => p[k].type === 'number');
      const price = priceKey ? (p[priceKey].number || 0) : 0;

      // 取得 C表的圖片 (Files)
      const imgKey = Object.keys(p).find(k => p[k].type === 'files');
      let imageUrl = '';
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = imgKey.files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      products.push({
        productName: parentData.productName,
        styleName: styleName,
        price: price,
        saleType: parentData.saleType,
        categories: parentData.categories,
        imageUrl: imageUrl,
        deadline: parentData.deadline,
        needDeposit: parentData.needDeposit,
        description: parentData.description
      });
    });

    // 3. 查詢公告表 (選填)
    let announcements = [];
    if (annDbId) {
      try {
        const annRes = await notion.databases.query({ database_id: annDbId, page_size: 5 });
        announcements = annRes.results.map(page => {
          const p = page.properties || {};
          let text = '';
          Object.keys(p).forEach(k => {
            const prop = p[k];
            if (prop.type === 'title' && prop.title?.[0]) text = prop.title.map(t => t.plain_text).join('');
            if (prop.type === 'rich_text' && prop.rich_text?.[0]) text = prop.rich_text.map(t => t.plain_text).join('');
          });
          return text;
        }).filter(Boolean);
      } catch (e) {}
    }

    return res.status(200).json({ success: true, products, announcements });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
