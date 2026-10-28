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
    const promoRulesDbId = process.env.PROMO_RULES_DB_ID;       // 優惠規則表

    if (!productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 PRODUCT_DETAIL_DB_ID 環境變數' });
    }

    // 0. 查詢 Promo_Rules 優惠規則資料庫
    const promoRulesMap = {}; // key 是 C 表的 page.id，value 是該款式的優惠規則陣列
    
    try {
      const promoRes = await notion.databases.query({ database_id: promoRulesDbId });
      
      promoRes.results.forEach(page => {
        const p = page.properties;
        
        // 1. 🛡️ 檢查是否「啟用」：沒打勾或設為隱藏就自動忽略
        let isActive = false;
        const activeKey = Object.keys(p).find(k => k.includes('啟用') || k.includes('狀態') || p[k].type === 'checkbox');
        if (activeKey) {
          isActive = p[activeKey].type === 'checkbox' ? p[activeKey].checkbox : (p[activeKey].select?.name === '啟用');
        }
        
        if (!isActive) return; // 沒啟用的活動直接跳過！

        // 2. 抓取關聯的 C 表款式 ID (支援多個關聯)
        let targetStyleIds = [];
        const relKey = Object.keys(p).find(k => p[k].type === 'relation');
        if (relKey && p[relKey].relation) {
          targetStyleIds = p[relKey].relation.map(r => r.id);
        }
        
        // 3. 讀取門檻、類型、數值與優先級
        const threshold = p['門檻數量']?.number || 3;
        const type = p['優惠類型']?.select?.name || '指定價格';
        const value = p['優惠數值']?.number || 0;
        const priority = p['優先級']?.number || 1;

        // 4. 將規則配對給對應的 C 表款式 ID
        targetStyleIds.forEach(styleId => {
          if (!promoRulesMap[styleId]) {
            promoRulesMap[styleId] = [];
          }
          promoRulesMap[styleId].push({ threshold, type, value, priority });
        });
      });
    } catch (promoErr) {
      console.warn("Promo_Rules 查詢失敗或未設定，將略過優惠：", promoErr.message);
    }

    // 1. 查詢 A 表 (主商品表)
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId, page_size: 100 });
        if (aRes && aRes.results) {
          aRes.results.forEach(page => {
            const p = page?.properties || {};
            let productName = '';
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title && Array.isArray(p[titleKey].title) && p[titleKey].title.length > 0) {
              productName = p[titleKey].title.map(t => t?.plain_text || '').join('');
            }
            if (!productName) return;
            
            let description = '';
            const descKey = Object.keys(p).find(k => (k.includes('說明') || k.includes('介紹') || k.includes('備註') || k.includes('內容')) && p[k]?.type === 'rich_text');
            if (descKey && p[descKey]?.rich_text && Array.isArray(p[descKey].rich_text) && p[descKey].rich_text.length > 0) {
              description = p[descKey].rich_text.map(t => t?.plain_text || '').join('');
            }

            let deadline = '';
            const dateKey = Object.keys(p).find(k => (k.includes('收單') || k.includes('截止') || k.includes('日期')) && p[k]?.type === 'date');
            if (dateKey && p[dateKey]?.date?.start) {
              deadline = p[dateKey].date.start;
            }

            let categories = ['全部'];
            const catKey = Object.keys(p).find(k => k.includes('分類') || k.includes('地區') || k.includes('category'));
            if (catKey && p[catKey]) {
              if (p[catKey].type === 'multi_select' && Array.isArray(p[catKey].multi_select)) {
                categories = p[catKey].multi_select.map(m => m?.name).filter(Boolean);
              } else if (p[catKey].type === 'select' && p[catKey].select?.name) {
                categories = [p[catKey].select.name];
              }
            }

            // 抓取是否需訂金 (needDeposit)
            let needDeposit = false;
            const depositKey = Object.keys(p).find(k => k.includes('訂金') || k.includes('押金') || k.includes('deposit'));
            if (depositKey && p[depositKey]) {
              const prop = p[depositKey];
              if (prop.type === 'checkbox') needDeposit = prop.checkbox;
              else if (prop.type === 'select' && prop.select?.name) {
                const val = prop.select.name.toLowerCase();
                if (val === '是' || val === '需訂金' || val === 'yes' || val === 'true') needDeposit = true;
              }
            }

             // 抓取是否新上架 (newproduce)
            let newproduce = false;
            const newproKey = Object.keys(p).find(k => k.includes('新品') || k.includes('新上架'));
            if (newproKey && p[newproKey]) {
              const nwprop = p[newproKey];
              if (nwprop.type === 'checkbox') newproduce = nwprop.checkbox;
              else if (nwprop.type === 'select' && nwprop.select?.name) {
                const nwval = prop.select.name.toLowerCase();
                if (nwval === '是' || nwval === '新品' || nwval === 'yes' || nwval === 'true' || nwval === '新上架') 
                  newproduce = true;
              }
            }

            aMapById[page.id] = { productName, description, categories, needDeposit, newproduce };
          });
        }
      } catch (e) {
        console.log("A表查詢略過或失敗:", e.message);
      }
    }

    // 2. 查詢 C 表 (款式明細表)
    const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
    const products = [];

    if (cRes && cRes.results) {
      cRes.results.forEach(page => {
        const p = page?.properties || {};

        //款式名稱 (Title)
        let styleName = '圖片款';
        const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
        if (titleKey && p[titleKey]?.title && Array.isArray(p[titleKey].title) && p[titleKey].title.length > 0) {
          styleName = p[titleKey].title.map(t => t?.plain_text || '').join('').trim() || '圖片款';
        }

        //商品名稱(relation)
        let parentData = null;
        const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
        if (relKey && p[relKey]?.relation && Array.isArray(p[relKey].relation) && p[relKey].relation.length > 0) {
          const parentId = p[relKey].relation[0]?.id;
          if (parentId) parentData = aMapById[parentId];
        }

        if (!parentData) {
          let fallbackName = '精選商品';
          const prodNameKey = Object.keys(p).find(k => (k.includes('商品') || k.includes('品名') || k.includes('名稱')) && p[k]?.type === 'rich_text');
          if (prodNameKey && p[prodNameKey]?.rich_text && Array.isArray(p[prodNameKey].rich_text) && p[prodNameKey].rich_text.length > 0) {
            fallbackName = p[prodNameKey].rich_text.map(t => t?.plain_text || '').join('').trim();
          }
          parentData = {
            productName: fallbackName,
            description: '',
            categories: ['全部'],
            needDeposit:false,
            newproduce:true
          };
        }

        let price = 0;
        const priceKeys = Object.keys(p).filter(k => p[k]?.type === 'number');
        if (priceKeys.length > 0) {
          const preferredPriceKey = priceKeys.find(k => k.includes('價') || k.includes('price') || k.includes('NT') || k.includes('金額')) || priceKeys[0];
          price = p[preferredPriceKey]?.number || 0;
        }

        // 🎯 穩健抓取 C 表的所有圖片網址陣列
        let imageUrls = [];
        const imgKey = Object.keys(p).find(k => p[k]?.type === 'files');
        
        if (imgKey && p[imgKey]?.files && Array.isArray(p[imgKey].files)) {
          imageUrls = p[imgKey].files.map(f => {
            // 🎯 優先抓取外部連結，若無則抓內部檔案網址
            let rawUrl = f?.external?.url || f?.file?.url || '';
            
            // 💡 防護罩：確保網址是字串且乾淨
            return String(rawUrl).trim();
          }).filter(Boolean);
        }

        const imageUrl = imageUrls.length > 0 ? imageUrls[0] : '';
        
        let saleType = '預購';
        const statusKey = Object.keys(p).find(k => k && (k.includes('狀態') || p[k]?.type === 'status' || p[k]?.type === 'select' || p[k]?.type === 'formula'));
        if (statusKey && p[statusKey]) {
          const prop = p[statusKey];
          let statusVal = '';
          if (prop.type === 'status') statusVal = prop.status?.name || '';
          else if (prop.type === 'select') statusVal = prop.select?.name || '';
          else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
            statusVal = prop.rich_text.map(t => t?.plain_text || '').join('');
          } else if (prop.type === 'formula') {
            statusVal = prop.formula?.string || prop.formula?.boolean?.toString() || String(prop.formula?.number ?? '');
          }

          const rawLower = String(statusVal).trim().toLowerCase();
          if (rawLower.includes('結束') || rawLower.includes('結單') || rawLower.includes('斷貨') || rawLower.includes('售完') || rawLower.includes('下架') || rawLower === 'false') {
            saleType = '已結束';
          } else if (rawLower !== '') {
            saleType = statusVal.trim();
          }
        }

        // 🎯 抓取收單日期 (deadline)
        let deadline = '';
        const cDateKey = Object.keys(p).find(k => p[k]?.type === 'date' || k.includes('收單') || k.includes('截止') || k.includes('日期'));
        if (cDateKey && p[cDateKey]) {
          if (p[cDateKey].type === 'date' && p[cDateKey].date?.start) {
            deadline = p[cDateKey].date.start;
          } else if (p[cDateKey].type === 'rich_text') {
            deadline = p[cDateKey].rich_text.map(t => t.plain_text || '').join('');
          }
        }

        // 🎯 核心：取得該款式對應到的 Notion 優惠規則陣列
        const assignedRules = promoRulesMap[page.id] || [];
        
        products.push({
          productName: parentData.productName,
          styleName,
          price,
          saleType,
          categories: parentData.categories,
          imageUrl,
          imageUrls,
          deadline,
          description: parentData.description,
          needDeposit: parentData.needDeposit,
          newproduce: parentData.newproduce,
          promoRules: assignedRules // 👈 完美帶入前台！
        });
      });
    }

    // 3. 查詢公告欄資料庫
    let announcements = [];
    if (annDbId) {
      try {
        const annRes = await notion.databases.query({ database_id: annDbId, page_size: 10 });
        if (annRes && annRes.results) {
          announcements = annRes.results.map(page => {
            const p = page?.properties || {};
            let isHidden = false;
            const statusKey = Object.keys(p).find(k => k.includes('狀態') || k.includes('status') || p[k]?.type === 'status' || p[k]?.type === 'select');
            if (statusKey && p[statusKey]) {
              const val = p[statusKey].status?.name || p[statusKey].select?.name || '';
              if (val === '隱藏' || val === '關閉' || val === '下架' || val === 'false') isHidden = true;
            }
            if (isHidden) return null;

            let contentText = '';
            const contentKey = Object.keys(p).find(k => (k.includes('內容') || k.includes('說明') || k.includes('公告')) && p[k]?.type === 'rich_text');
            if (contentKey && p[contentKey]?.rich_text && Array.isArray(p[contentKey].rich_text) && p[contentKey].rich_text.length > 0) {
              contentText = p[contentKey].rich_text.map(t => t?.plain_text || '').join('');
            }
            if (!contentText) {
              Object.keys(p).forEach(k => {
                const prop = p[k];
                if (!contentText && prop?.type === 'rich_text' && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
                  contentText = prop.rich_text.map(t => t?.plain_text || '').join('');
                } else if (!contentText && prop?.type === 'title' && Array.isArray(prop.title) && prop.title.length > 0) {
                  contentText = prop.title.map(t => t?.plain_text || '').join('');
                }
              });
            }
            return contentText;
          }).filter(Boolean);
        }
      } catch (e) {}
    }

    return res.status(200).json({ success: true, products, announcements });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
