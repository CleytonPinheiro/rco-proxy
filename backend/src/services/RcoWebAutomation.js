import { getBrowser } from '../../auth-puppeteer.js';
import { loginWithPuppeteer } from '../../auth-puppeteer.js';

const RCO_BASE = 'https://rco.paas.pr.gov.br';

export class RcoWebAutomation {

    static async criarAvaliacao({ cpf, senha, codClasse, tipo, dataAvaliacao, nomeDisciplina }) {
        if (!cpf || !senha) throw new Error('CPF e senha são obrigatórios.');
        if (!codClasse)     throw new Error('codClasse é obrigatório.');
        if (!tipo || !['AV1', 'Recuperação'].includes(tipo)) {
            throw new Error('tipo deve ser "AV1" ou "Recuperação".');
        }
        if (!dataAvaliacao) throw new Error('dataAvaliacao é obrigatória (YYYY-MM-DD).');

        const log = (msg) => console.log(`[RCO-WEB] ${msg}`);
        log(`Criando avaliação tipo=${tipo} classe=${codClasse} data=${dataAvaliacao} disciplina=${nomeDisciplina || '?'}`);

        await loginWithPuppeteer(cpf, senha);
        log('Login OK.');

        const browser = await getBrowser();
        const page = await browser.newPage();

        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1280, height: 900 });

            await page.setRequestInterception(true);
            const capturedRequests = [];

            page.on('request', req => {
                const url = req.url();
                if (url.includes('avaliacaoParcialClasse') && ['POST', 'PUT'].includes(req.method())) {
                    capturedRequests.push({
                        url, method: req.method(),
                        postData: req.postData()?.substring(0, 500),
                    });
                    log(`CAPTURED ${req.method()} ${url}`);
                }
                req.continue();
            });

            page.on('response', async resp => {
                const url = resp.url();
                if (url.includes('avaliacaoParcialClasse') && ['POST', 'PUT'].includes(resp.request().method())) {
                    try {
                        const body = await resp.text();
                        log(`RESPONSE ${resp.request().method()} ${resp.status()}: ${body.substring(0, 300)}`);
                    } catch {}
                }
            });

            log('1/6 Navegando para RCO...');
            await page.goto(RCO_BASE, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.sleep(2000);

            log('2/6 Selecionando REDE ESTADUAL...');
            const redeOk = await page.evaluate(() => {
                const labels = document.querySelectorAll('label.btn');
                for (const lbl of labels) {
                    if (lbl.textContent?.trim()?.includes('REDE ESTADUAL')) {
                        const radio = lbl.querySelector('input');
                        if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
                        lbl.click();
                        return true;
                    }
                }
                return false;
            });
            if (!redeOk) throw new Error('Não encontrou REDE ESTADUAL');
            await this.sleep(4000);

            let pageText = await page.evaluate(() => document.body?.innerText || '');
            if (pageText.includes('Selecione a Rede')) throw new Error('Falha ao selecionar REDE ESTADUAL');
            log('REDE ESTADUAL selecionada OK');

            log('3/6 Abrindo "Selecionar Livro"...');
            const btns = await page.$$('button.btn.btn-link');
            for (const b of btns) {
                const txt = await b.evaluate(el => el.textContent?.trim());
                if (txt?.includes('Selecionar Livro')) { await b.click(); break; }
            }
            await this.sleep(3000);

            pageText = await page.evaluate(() => document.body?.innerText || '');
            log(`Página livros (${pageText.length} chars). Contém BANCO DE DADOS: ${pageText.includes('BANCO DE DADOS')}`);

            log('4/6 Clicando no trimestre da disciplina correta...');
            const fullText = await page.evaluate(() => document.body?.innerText || '');
            log(`Texto completo (últimos 800): ${fullText.substring(fullText.length - 800)}`);

            if (!nomeDisciplina) {
                throw new Error('nomeDisciplina é obrigatório para selecionar o livro correto no RCO.');
            }
            const searchTerms = [nomeDisciplina.toUpperCase()];

            const triClicked = await page.evaluate((terms) => {
                const allElements = [...document.querySelectorAll('*')];

                for (let i = 0; i < allElements.length; i++) {
                    const el = allElements[i];
                    const directNodes = [...el.childNodes].filter(n => n.nodeType === 3);
                    const directText = directNodes.map(n => n.textContent?.trim()).join(' ').trim();

                    if (!directText) continue;

                    for (const term of terms) {
                        const termUpper = term.toUpperCase();
                        const textUpper = directText.toUpperCase();

                        if (textUpper === termUpper || textUpper.startsWith(termUpper + ' ') || textUpper.endsWith(' ' + termUpper)) {
                            for (let j = i + 1; j < Math.min(i + 15, allElements.length); j++) {
                                const nextEl = allElements[j];
                                if (nextEl.tagName === 'A' && nextEl.classList?.contains('btn-outline-primary')) {
                                    const triText = nextEl.textContent?.trim();
                                    if (triText?.includes('1º Tri')) {
                                        nextEl.click();
                                        return { clicked: true, method: 'exact-sequential', text: triText, foundAt: directText };
                                    }
                                }
                            }

                            let parent = el.parentElement;
                            for (let p = 0; p < 5; p++) {
                                if (!parent) break;
                                const triBtn = parent.querySelector('a.btn.btn-outline-primary');
                                if (triBtn && triBtn.textContent?.trim()?.includes('1º Tri')) {
                                    triBtn.click();
                                    return { clicked: true, method: 'exact-parent', text: triBtn.textContent?.trim(), foundAt: directText };
                                }
                                parent = parent.parentElement;
                            }
                        }
                    }
                }

                return { clicked: false, terms };
            }, searchTerms);
            log(`Trimestre click: ${JSON.stringify(triClicked)}`);

            if (!triClicked.clicked) {
                log('Trimestre não encontrado via DOM traversal. Tentando método alternativo...');

                const altResult = await page.evaluate((terms) => {
                    const html = document.body?.innerHTML || '';
                    const text = document.body?.innerText || '';
                    
                    const allCards = document.querySelectorAll('div, section, article');
                    for (const card of allCards) {
                        const cardText = card.textContent || '';
                        const hasMatch = terms.some(t => cardText.toUpperCase().includes(t.toUpperCase()));
                        if (hasMatch && cardText.length < 500) {
                            const tri = card.querySelector('a[class*="outline-primary"]');
                            if (tri) {
                                tri.click();
                                return { clicked: true, text: tri.textContent?.trim(), cardText: cardText.substring(0, 100) };
                            }
                        }
                    }
                    return { clicked: false, fullText: text };
                }, searchTerms);

                if (altResult.clicked) {
                    log(`Alt method OK: ${JSON.stringify({ text: altResult.text, card: altResult.cardText })}`);
                } else {
                    log(`Full page text: ${altResult.fullText}`);
                    throw new Error('Não encontrou a disciplina/trimestre no RCO. Tente criar a avaliação manualmente.');
                }
            }

            await this.sleep(5000);

            pageText = await page.evaluate(() => document.body?.innerText || '');
            log(`5/6 Dentro do livro (${pageText.length} chars): ${pageText.substring(0, 600)}`);

            const livroMenuItems = await page.evaluate(() => {
                const items = document.querySelectorAll('a, button, li, span, .nav-link, .tab, [role="tab"]');
                return [...items].map(el => ({
                    tag: el.tagName,
                    text: el.textContent?.trim()?.substring(0, 40),
                    class: el.className?.substring?.(0, 50) || '',
                    href: el.getAttribute('href')?.substring(0, 50) || '',
                })).filter(e => e.text && e.text.length > 0 && e.text.length < 40).slice(0, 40);
            });
            log(`Livro menu items: ${JSON.stringify(livroMenuItems.slice(0, 20))}`);

            const avalLink = livroMenuItems.find(e => e.tag === 'A' && /^Avalia[çc][ãa]o$/i.test(e.text));
            if (avalLink) {
                log(`Encontrou link "Avaliação" (href=${avalLink.href}). Clicando via Puppeteer nativo...`);
                const avalLinks = await page.$$('a');
                for (const a of avalLinks) {
                    const txt = await a.evaluate(el => el.textContent?.trim());
                    if (/^Avalia[çc][ãa]o$/i.test(txt || '')) {
                        await a.click();
                        log('Clicou no link Avaliação');
                        break;
                    }
                }
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
                await this.sleep(3000);
                pageText = await page.evaluate(() => document.body?.innerText || '');
                log(`Após aba Avaliação (URL: ${page.url()}): ${pageText.substring(0, 600)}`);
            }

            const formReady = pageText.includes('Avaliação Parcial') || pageText.includes('AVALIAÇÃO') ||
                              pageText.includes('Tipo de Avaliação') || pageText.includes('Data da Avaliação') ||
                              pageText.includes('Nova Avaliação') || pageText.includes('Cadastrar Avaliação') ||
                              pageText.includes('Criar Avaliação') || pageText.includes('AV1');

            if (formReady) {
                log('6/6 Formulário encontrado! Preenchendo...');
                await this.fillAndSubmitForm(page, tipo, dataAvaliacao, log);

                await this.sleep(5000);
                pageText = await page.evaluate(() => document.body?.innerText || '');
                log(`Resultado após Avançar (URL: ${page.url()}): ${pageText.substring(0, 800)}`);

                const hasAlert = await page.evaluate(() => {
                    const alerts = document.querySelectorAll('.alert, .toast, .modal, [role="alert"], [class*="alert"], [class*="success"], [class*="error"], [class*="warning"]');
                    const msgs = [];
                    for (const a of alerts) {
                        const txt = a.textContent?.trim();
                        if (txt && txt.length > 0 && txt.length < 200) msgs.push({ class: (typeof a.className === 'string' ? a.className : '').substring(0, 40), text: txt.substring(0, 100) });
                    }
                    return msgs;
                });
                log(`Alertas/modais: ${JSON.stringify(hasAlert)}`);

                const hasConfirmBtn = await page.evaluate(() => {
                    const btns = document.querySelectorAll('button, a.btn');
                    const result = [];
                    for (const btn of btns) {
                        const txt = btn.textContent?.trim() || '';
                        if (/salvar|gravar|confirmar|ok|sim/i.test(txt)) {
                            result.push(txt);
                        }
                    }
                    return result;
                });
                log(`Botões de confirmação: ${JSON.stringify(hasConfirmBtn)}`);

                if (hasConfirmBtn.length > 0) {
                    log(`Clicando em "${hasConfirmBtn[0]}"...`);
                    await page.evaluate((btnText) => {
                        const btns = document.querySelectorAll('button, a.btn');
                        for (const btn of btns) {
                            if (btn.textContent?.trim() === btnText) { btn.click(); return; }
                        }
                    }, hasConfirmBtn[0]);
                    await this.sleep(8000);
                    pageText = await page.evaluate(() => document.body?.innerText || '');
                    log(`Após Salvar (${pageText.length} chars): ${pageText.substring(0, 500)}`);

                    const toastMsg = await page.evaluate(() => {
                        const toasts = document.querySelectorAll('.toast-body, .b-toast .toast, [class*="toast"], [class*="alert-success"]');
                        const msgs = [];
                        for (const t of toasts) {
                            const txt = t.textContent?.trim();
                            if (txt && txt.length > 0) msgs.push(txt.substring(0, 100));
                        }
                        return msgs;
                    });
                    if (toastMsg.length > 0) log(`Toast: ${JSON.stringify(toastMsg)}`);
                }
            } else {
                log(`Formulário NÃO encontrado. Conteúdo: ${pageText.substring(0, 800)}`);
                throw new Error('Formulário de avaliação não encontrado no RCO. Tente criar manualmente.');
            }

            pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');

            return {
                sucesso: true,
                tipo,
                dataAvaliacao,
                codClasse,
                urlFinal: page.url(),
                capturedRequests,
                resultPage: pageText.substring(0, 300),
            };
        } catch (e) {
            log(`ERRO: ${e.message}`);
            throw e;
        } finally {
            try { await page.close(); } catch {}
        }
    }

    static async fillAndSubmitForm(page, tipo, dataAvaliacao, log) {
        log(`Selecionando tipo=${tipo}...`);
        const radioResult = await page.evaluate((tipoStr) => {
            const labels = document.querySelectorAll('label');
            for (const label of labels) {
                const text = label.textContent?.trim() || '';
                if (
                    (tipoStr === 'AV1' && /AV\s*1/i.test(text)) ||
                    (tipoStr === 'Recuperação' && /Recupera/i.test(text))
                ) {
                    const radio = label.querySelector('input[type="radio"]') ||
                                 document.getElementById(label.getAttribute('for') || '');
                    if (radio) {
                        radio.click();
                        radio.dispatchEvent(new Event('change', { bubbles: true }));
                        return { found: true, text, method: 'label' };
                    }
                }
            }
            const radios = document.querySelectorAll('input[type="radio"]');
            for (let i = 0; i < radios.length; i++) {
                const parent = radios[i].closest('label, div, span');
                const txt = parent?.textContent?.trim() || '';
                if (
                    (tipoStr === 'AV1' && (i === 0 || /AV\s*1/i.test(txt))) ||
                    (tipoStr === 'Recuperação' && (i === 1 || /Recupera/i.test(txt)))
                ) {
                    radios[i].click();
                    radios[i].dispatchEvent(new Event('change', { bubbles: true }));
                    return { found: true, text: txt || `index-${i}`, method: 'index' };
                }
            }
            return { found: false, radios: radios.length };
        }, tipo);
        log(`Radio: ${JSON.stringify(radioResult)}`);
        if (!radioResult.found) throw new Error(`Não foi possível selecionar o tipo ${tipo} no formulário.`);

        await this.sleep(500);

        log(`Preenchendo data: ${dataAvaliacao}...`);
        const [y, m, d] = dataAvaliacao.split('-');
        const formatted = `${d}/${m}/${y}`;

        const dateFieldInfo = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input');
            const info = [];
            for (const inp of inputs) {
                info.push({
                    type: inp.type, placeholder: inp.placeholder?.substring(0, 40),
                    class: inp.className?.substring(0, 40), id: inp.id,
                    name: inp.name, visible: inp.offsetParent !== null,
                    parent: inp.parentElement?.className?.substring(0, 40),
                });
            }

            const datepickers = document.querySelectorAll('[class*="date"], [class*="calendar"], [class*="datepicker"], .b-form-btn-label-control');
            const dpInfo = [];
            for (const dp of datepickers) {
                dpInfo.push({ tag: dp.tagName, class: (typeof dp.className === 'string' ? dp.className : '').substring(0, 60), text: dp.textContent?.trim()?.substring(0, 40) });
            }

            return { inputs: info, datepickers: dpInfo };
        });
        log(`Date fields: ${JSON.stringify(dateFieldInfo)}`);

        const dpBtn = await page.$('.b-form-datepicker button, .b-form-btn-label-control button');
        if (dpBtn) {
            await dpBtn.click();
            log('Clicou no botão do datepicker');
            await this.sleep(1500);

            const [targetY, targetM, targetD] = dataAvaliacao.split('-').map(Number);
            const targetISO = dataAvaliacao;

            for (let attempt = 0; attempt < 24; attempt++) {
                const calState = await page.evaluate((iso) => {
                    const cell = document.querySelector(`[data-date="${iso}"]`);
                    if (cell) return { found: true };

                    const header = document.querySelector('.b-calendar-grid-caption, .b-calendar header, [class*="calendar"] [class*="header"]');
                    const headerText = header?.textContent?.trim() || '';

                    const allCells = document.querySelectorAll('[data-date]');
                    const dates = [];
                    allCells.forEach(c => dates.push(c.getAttribute('data-date')));

                    return { found: false, headerText, sampleDates: dates.slice(0, 3) };
                }, targetISO);

                if (calState.found) {
                    log(`Data ${targetISO} encontrada no calendário`);
                    break;
                }

                log(`Nav calendário attempt ${attempt}: ${JSON.stringify(calState)}`);

                const currentMonth = calState.sampleDates?.[0] ? new Date(calState.sampleDates[0]).getMonth() + 1 : null;
                const currentYear = calState.sampleDates?.[0] ? new Date(calState.sampleDates[0]).getFullYear() : null;

                if (!currentMonth) {
                    log('Calendário sem datas visíveis, saindo');
                    break;
                }

                const targetMonths = targetY * 12 + targetM;
                const currentMonths = currentYear * 12 + currentMonth;
                const diff = targetMonths - currentMonths;

                if (diff === 0) break;

                const navSelector = diff > 0 
                    ? '.b-calendar [aria-label*="next" i], .b-calendar [title*="Next" i], .b-calendar-nav button:last-child'
                    : '.b-calendar [aria-label*="prev" i], .b-calendar [title*="Prev" i], .b-calendar-nav button:first-child';
                
                const navClicked = await page.evaluate((sel) => {
                    const btns = document.querySelectorAll('.b-calendar-nav button, .b-calendar button[class*="nav"]');
                    if (btns.length >= 5) {
                        const idx = sel.includes('next') || sel.includes('last') ? 3 : 1;
                        btns[idx]?.click();
                        return { clicked: true, method: 'nav-index', idx };
                    }
                    const el = document.querySelector(sel);
                    if (el) { el.click(); return { clicked: true, method: 'selector' }; }
                    return { clicked: false };
                }, navSelector);
                log(`Nav click: ${JSON.stringify(navClicked)}`);
                await this.sleep(500);
            }

            const cellSelector = `[data-date="${targetISO}"]`;
            const cellExists = await page.$(cellSelector);
            if (cellExists) {
                await page.click(cellSelector);
                log(`Puppeteer native click on ${cellSelector}`);
                await this.sleep(1500);

                const afterClick1 = await page.evaluate(() => {
                    const dp = document.querySelector('.b-form-datepicker, .b-form-btn-label-control');
                    const dpVue = dp?.__vue__;
                    const label = dp?.querySelector('label, .form-control');
                    return {
                        labelText: label?.textContent?.trim()?.substring(0, 60),
                        vueLocalYMD: dpVue?.localYMD,
                        vueValue: dpVue?.value,
                        formattedValue: dpVue?.formattedValue,
                        dropdownOpen: dp?.querySelector('.dropdown-menu.show') !== null,
                    };
                });
                log(`After native click: ${JSON.stringify(afterClick1)}`);

                if (!afterClick1.vueValue) {
                    log('Value still empty after native click. Trying double-click...');
                    const stillOpen = await page.$('.b-form-datepicker .dropdown-menu.show, .b-form-btn-label-control .dropdown-menu.show');
                    if (!stillOpen) {
                        await dpBtn.click();
                        await this.sleep(1000);
                    }
                    const cell2 = await page.$(cellSelector);
                    if (cell2) {
                        await page.click(cellSelector);
                        await this.sleep(1500);
                    }

                    const afterClick2 = await page.evaluate(() => {
                        const dp = document.querySelector('.b-form-datepicker, .b-form-btn-label-control');
                        const dpVue = dp?.__vue__;
                        return { vueValue: dpVue?.value, localYMD: dpVue?.localYMD, formattedValue: dpVue?.formattedValue };
                    });
                    log(`After 2nd click: ${JSON.stringify(afterClick2)}`);
                }
            } else {
                throw new Error(`Célula de data ${targetISO} não encontrada no calendário.`);
            }
        } else {
            log('Datepicker button não encontrado. Tentando keyboard...');
            const labelEl = await page.$('.b-form-datepicker, label[for*="date"]');
            if (labelEl) await labelEl.click();
            await this.sleep(500);
            await page.keyboard.type(formatted);
        }
        await this.sleep(500);

        const pesoInput = await page.$('#pesoDecimal');
        if (pesoInput) {
            await pesoInput.click({ clickCount: 3 });
            await page.keyboard.type('10');
            log('Campo Valor preenchido: 10');
        } else {
            log('Campo pesoDecimal não encontrado');
        }
        await this.sleep(500);
        log(`Data preenchida: ${formatted}, valor: 10`);

        log('Clicando botão de submissão...');
        const btnResult = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button, a.btn, input[type="submit"]');
            const names = [];
            for (const btn of buttons) {
                const txt = btn.textContent?.trim() || '';
                names.push(txt);
                if (/avan[cç]ar|salvar|cadastrar|criar|gravar|confirmar/i.test(txt)) {
                    btn.click();
                    return { found: true, text: txt };
                }
            }
            return { found: false, buttons: names.slice(0, 15) };
        });
        log(`Submit: ${JSON.stringify(btnResult)}`);
        if (!btnResult.found) throw new Error('Botão Avançar/Salvar não encontrado no formulário.');

        await this.sleep(5000);
    }

    static sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}
