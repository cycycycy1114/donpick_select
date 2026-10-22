// 2. 查詢 C表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      let parentInfo = null;
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      
      if (relKey && p[relKey].relation.length > 0) {
        const relId = p[relKey].relation[0].id;
        if (validAMap[relId]) {
          parentInfo = validAMap[relId];
        } else {
          return; // 已結束或未找到主商品，排除
        }
      } else {
        return; // 未關聯 A表則排除
      }

      // 🎯 【直接鎖定】抓取 C 表中 type === 'title'（即標題欄位「款式名稱」）的文字
      let styleName = '標準款式';
      const titleKey = Object.keys(p).find(k => p[k].type === 'title');
      if (titleKey && p[titleKey].title?.[0]) {
        styleName = p[titleKey].title.map(t => t.plain_text).join('') || '標準款式';
      }

      // 抓取價格 (number)
      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k].type === 'number');
      if (priceKey) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => p[k].type === 'number');
        if (anyNumKey) price = p[anyNumKey].number || 0;
      }

      // 抓取圖片 (files)
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => k.type === 'files' || k.includes('圖'));
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      products.push({
        productName: parentInfo.name,
        categories: parentInfo.categories,
        saleType: parentInfo.saleType,
        deadline: parentInfo.deadline,
        needDeposit: parentInfo.needDeposit,
        styleName: styleName,
        price: price,
        imageUrl: imageUrl
      });
    });
