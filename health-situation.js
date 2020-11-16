/*
**  Health-Situation -- Scraping Current Health Situation Information
**  Copyright (c) 2020 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under GPL 3.0 <https://spdx.org/licenses/GPL-3.0-only>
*/

/*  built-in requirements  */
const fs        = require("fs")
const url       = require("url")

/*  external requirements  */
const dotenv    = require("dotenv")
const chalk     = require("chalk")
const puppeteer = require("puppeteer-core")
const got       = require("got")
const execa     = require("execa")
const prince    = require("prince")
const PDFScrape = require("pdf-scrape")
const mkdirp    = require("mkdirp")

;(async () => {
    /*  fetch environment variables  */
    dotenv.config()

    /*  some verbose output support  */
    const verbose = (level, msg) => {
        if (level === 1)
            process.stdout.write(`++ ${chalk.blue.bold(msg)}\n`)
        else
            process.stdout.write(`-- ${chalk.blue(msg)}\n`)
    }

    /*  ensure temporary directories are available  */
    const srcDir = "health-situation.src.d"
    const dstDir = "health-situation.dst.d"
    mkdirp(srcDir)
    mkdirp(dstDir)

    /*  create PDF Scraper  */
    const pdfScrape = new PDFScrape({
        mergeFragments:   true,
        roundCoordinates: true,
        lineThreshold:    0.5,
        charThreshold:    1.5,
        wordThreshold:    5.0
    })

    /*  open/close Puppeteer connections  */
    class Puppeteer {
        async connect () {
            verbose(2, "connecting to remote browser")
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
            this.browser = await puppeteer.connect({
                browserWSEndpoint: process.env.PUPPETEER_URL,
                defaultViewport:   { width: 1024, height: 2048, deviceScaleFactor: 2 }
            })
            this.page = await this.browser.newPage()
            await this.page.emulateMediaType("screen")
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
        }
        async disconnect () {
            verbose(2, "disconnecting from remote browser")
            await this.browser.close()
            this.browser = null
        }
    }

    /*  helper function for cropping a PDF and exporting in SVG format  */
    const pdfCroppedExport = (input, output, page, x, y, w, h) => {
        return execa.command(
            `pdftocairo -svg -f ${page} -l ${page} ` +
            `-x ${x} -y ${y} -W ${w} -H ${h} -paperw ${w} -paperh ${h} ` +
            `${input} ${output}`
        )
    }

    /*  ==== RKI GrippeWeb ====  */
    const genRKIGrippeWeb = async () => {
        verbose(1, "RKI GrippeWeb")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to RKI GrippeWeb homepage")
        const baseURL = "https://grippeweb.rki.de/"
        await puppeteer.page.goto(baseURL)

        verbose(2, "determining Diagrams")
        const subURLs = await puppeteer.page.$$eval("img[src]", (els) => {
            return [].filter.call(els, (el) => el.getAttribute("src").match(/Diagrams\/.+?\.png/))
                .map((el) => el.getAttribute("src"))
        })
        let i = 1
        for (const subURL of subURLs) {
            verbose(2, `fetching Diagram #${i}`)
            const imgURL = new url.URL(subURL, baseURL)
            const result = await got({ url: imgURL, responseType: "buffer" })
            await fs.promises.writeFile(`${dstDir}/rki-grippeweb-${i++}.png`, result.body, { encoding: null })
        }
        await puppeteer.disconnect()
    }

    /*  ==== RKI Influenza ====  */
    const genRKIInfluenza = async () => {
        verbose(1, "RKI Influenza")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to RKI Influenza homepage")
        const baseURL = "https://influenza.rki.de/"
        await puppeteer.page.goto(baseURL)

        verbose(2, "determining PDF link")
        const subURL = await puppeteer.page.$$eval("a[href]", (els) => {
            const el = [].find.call(els, (el) =>
                el.getAttribute("href").match(/Wochenberichte\/.+?\.pdf/))
            return el.getAttribute("href")
        })
        const pdfURL = new url.URL(subURL, baseURL)

        verbose(2, "fetching PDF artifact")
        const result = await got({ url: pdfURL, responseType: "buffer" })
        await fs.promises.writeFile(`${srcDir}/rki-influenza.pdf`, result.body, { encoding: null })

        verbose(2, "parsing PDF artifact")
        const items = await pdfScrape.findMatching(result.body, {
            info1: /Meldungen .ber das SEED/,
            info2: /Abb. 5:/,
            info3: /Internationale Situatio/,
            info4: /Die Anzahl der eingesandten Proben/
        })

        verbose(2, "cropping PDF page and exporting to SVG")
        await pdfCroppedExport(`${srcDir}/rki-influenza.pdf`, `${dstDir}/rki-influenza-1.svg`,
            items.info1.p, items.info1.x, items.info1.y + 30, 600, 260)
        await pdfCroppedExport(`${srcDir}/rki-influenza.pdf`, `${dstDir}/rki-influenza-2.svg`,
            items.info2.p, items.info2.x, items.info2.y - 230, 600, 230)
        await pdfCroppedExport(`${srcDir}/rki-influenza.pdf`, `${dstDir}/rki-influenza-3.svg`,
            items.info3.p, items.info3.x, items.info3.y - 340, 600, 270)
        await pdfCroppedExport(`${srcDir}/rki-influenza.pdf`, `${dstDir}/rki-influenza-4.svg`,
            items.info4.p, 0, items.info4.y - 310, 600, 310)
        await puppeteer.disconnect()
    }

    /*  ==== RKI Corona ====  */
    const genRKICorona = async () => {
        verbose(1, "RKI Corona")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to RKI Corona homepage")
        const baseURL = "https://www.rki.de/DE/Content/InfAZ/N/Neuartiges_Coronavirus/Situationsberichte/Gesamt.html"
        await puppeteer.page.goto(baseURL)

        verbose(2, "determining PDF link")
        const subURL = await puppeteer.page.$$eval("a[href]", (els) => {
            const el = [].find.call(els, (el) =>
                el.getAttribute("href").match(/Situationsberichte\/.+\.pdf/))
            return el.getAttribute("href")
        })
        const pdfURL = new url.URL(subURL, baseURL)

        verbose(2, "fetching PDF artifact")
        const result = await got({ url: pdfURL, responseType: "buffer" })
        await fs.promises.writeFile(`${srcDir}/rki-corona.pdf`, result.body, { encoding: null })

        verbose(2, "parsing PDF artifact")
        const items = await pdfScrape.findMatching(result.body, {
            stats:   /Bestätigte Fälle/,
            curve:   /Abbildung 2: Anzahl der an das RKI/,
            rwert:   /7-Tage-R-Wert/,
            predict: /Abbildung 4: Darstellung/
        })

        verbose(2, "cropping PDF page and exporting to SVG")
        await pdfCroppedExport(`${srcDir}/rki-corona.pdf`, `${dstDir}/rki-corona-1.svg`,
            items.stats.p, 50, items.stats.y, 600, 160)
        await pdfCroppedExport(`${srcDir}/rki-corona.pdf`, `${dstDir}/rki-corona-2.svg`,
            items.curve.p, items.curve.x, items.curve.y - 250, 600, 250)
        await pdfCroppedExport(`${srcDir}/rki-corona.pdf`, `${dstDir}/rki-corona-3.svg`,
            items.rwert.p, 290, items.rwert.y - 10, 300, 60)
        await pdfCroppedExport(`${srcDir}/rki-corona.pdf`, `${dstDir}/rki-corona-4.svg`,
            items.predict.p, items.predict.x, items.predict.y - 265, 600, 265)
        await puppeteer.disconnect()
    }

    /*  ==== RKI ARS/SARS-CoV-2 ====  */
    const genRKIARS = async () => {
        verbose(1, "RKI ARS/SARS-CoV-2")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to RKI ARS/SARS-CoV-2 homepage")
        const baseURL = "https://ars.rki.de/Content/COVID19/Main.aspx"
        await puppeteer.page.goto(baseURL)

        verbose(2, "determining PDF link")
        const subURL = await puppeteer.page.$$eval("a[href]", (els) => {
            const el = [].find.call(els, (el) =>
                el.getAttribute("href").match(/\d+_wochenbericht\.pdf/))
            return el.getAttribute("href")
        })
        const pdfURL = new url.URL(subURL, baseURL)

        verbose(2, "fetching PDF artifact")
        const result = await got({ url: pdfURL, responseType: "buffer" })
        await fs.promises.writeFile(`${srcDir}/rki-ars.pdf`, result.body, { encoding: null })

        verbose(2, "parsing PDF artifact")
        const items = await pdfScrape.findMatching(result.body, {
            stat:  /Abbildung\s+1:/,
            stat2: /Anzahl der Tage zwischen Probenentnahme/
        })

        verbose(2, "cropping PDF page and exporting to SVG")
        await pdfCroppedExport(`${srcDir}/rki-ars.pdf`, `${dstDir}/rki-ars-1.svg`,
            items.stat.p, items.stat.x, items.stat.y + 100, 600, 250)
        await pdfCroppedExport(`${srcDir}/rki-ars.pdf`, `${dstDir}/rki-ars-2.svg`,
            items.stat2.p, 50, items.stat2.y + 50, 600, 280)
        await puppeteer.disconnect()
    }

    /*  ==== RKI & Corona-Data.eu ====  */
    const genRKICoronaData = async () => {
        verbose(1, "RKI Corona Heatmaps")

        const locations = [
            { url: "https://corona-data.eu/media/bl/pdf/Bayern.pdf",      name: "bayern" },
            { url: "https://corona-data.eu/media/lk/pdf/LK-Dachau.pdf",   name: "lk-dachau" },
            { url: "https://corona-data.eu/media/lk/pdf/LK-Freising.pdf", name: "lk-freising" },
            { url: "https://corona-data.eu/media/lk/pdf/LK-Muenchen.pdf", name: "lk-muenchen" },
            { url: "https://corona-data.eu/media/lk/pdf/SK-Muenchen.pdf", name: "sk-muenchen" }
        ]
        for (const location of locations) {
            verbose(2, `fetching PDF artifact "${location.name}"`)
            const result = await got({ url: location.url, responseType: "buffer" })
            await fs.promises.writeFile(`${srcDir}/rki-corona-heatmap-${location.name}.pdf`, result.body, { encoding: null })
            await execa.command(`pdftocairo -svg ${srcDir}/rki-corona-heatmap-${location.name}.pdf ${dstDir}/rki-corona-heatmap-${location.name}.svg`)
        }
    }

    /*  ==== DIVI Intensivregister ====  */
    const genDivi = async () => {
        verbose(1, "DIVI Intensivregister")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to DIVI homepage")
        const baseURL = "https://www.divi.de/register/tagesreport"
        await puppeteer.page.goto(baseURL)

        verbose(2, "determining PDF link")
        const subURL = await puppeteer.page.$$eval("a[href]", (els) => {
            const el = [].find.call(els, (el) =>
                el.getAttribute("href").match(/DIVI-Intensivregister_Tagesreport_.+?\.pdf/))
            return el.getAttribute("href")
        })
        const pdfURL = new url.URL(subURL, baseURL)

        verbose(2, "fetching PDF artifact")
        const result = await got({ url: pdfURL, responseType: "buffer" })
        await fs.promises.writeFile(`${srcDir}/divi.pdf`, result.body, { encoding: null })

        verbose(2, "cropping PDF page and exporting to SVG")
        await pdfCroppedExport(`${srcDir}/divi.pdf`, `${dstDir}/divi-1.svg`,
            1, 30, 265, 600, 200)
        await pdfCroppedExport(`${srcDir}/divi.pdf`, `${dstDir}/divi-2.svg`,
            1, 300, 575, 300, 70)
        await puppeteer.disconnect()
    }

    /*  ==== DeStatis Sterbefallzahlen ====  */
    const genDeStatis = async () => {
        verbose(1, "DeStatis Sterbefallzahlen")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to DeStatis page")
        const baseURL = "https://www.destatis.de/DE/Themen/Querschnitt/Corona/Gesellschaft/bevoelkerung-sterbefaelle.html"
        await puppeteer.page.goto(baseURL)

        verbose(2, "scraping DeStatis page as PNG")
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await puppeteer.page.screenshot({ clip: { x: 180, y: 680, width: 720, height: 380 }, path: `${dstDir}/destatis-1.png` })
        await puppeteer.disconnect()
    }

    /*  ==== Google Sterbefallzahlen ====  */
    const genGoogle = async () => {
        verbose(1, "Google Sterbefallzahlen")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to Google page")
        const baseURL = "https://www.google.com/search?q=corona+todesf%C3%A4lle"
        await puppeteer.page.goto(baseURL)

        verbose(2, "scraping Google page as PNG")
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await puppeteer.page.screenshot({ clip: { x: 190, y: 380, width: 640, height: 210 }, path: `${dstDir}/google-1.png` })
        await puppeteer.disconnect()
    }

    /*  ==== WHO Influenza ====  */
    const genWHO = async () => {
        verbose(1, "WHO Influenza")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to WHO Influenza page")
        const baseURL = "https://apps.who.int/flumart/Default?ReportNo=3&WHORegion=EUR"
        await puppeteer.page.goto(baseURL)

        verbose(2, "scraping Google page as PNG")
        await new Promise((resolve) => setTimeout(resolve, 6000))
        await puppeteer.page.screenshot({ clip: { x: 0, y: 330, width: 980, height: 520 }, path: `${dstDir}/who-1.png` })
        await puppeteer.disconnect()
    }

    /*  ==== Euromomo ====  */
    const genEuromomo = async () => {
        verbose(1, "Euromomo")
        const puppeteer = new Puppeteer()
        await puppeteer.connect()

        verbose(2, "navigating to Euromomo page")
        const baseURL = "https://www.euromomo.eu/graphs-and-maps"
        await puppeteer.page.goto(baseURL)

        verbose(2, "scraping Euromomo page as PNG")
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await puppeteer.page.screenshot({ clip: { x: 260, y: 880, width: 750, height: 350 }, path: `${dstDir}/euromomo-1.png` })
        await puppeteer.disconnect()
    }

    /*  call the individual scrapings  */
    await genRKIGrippeWeb()
    await genRKIInfluenza()
    await genRKICorona()
    await genRKIARS()
    await genRKICoronaData()
    await genDivi()
    await genDeStatis()
    await genGoogle()
    await genWHO()
    await genEuromomo()

    /*  render the final PDF document, aggregating all scrapings  */
    await prince()
        .inputs("health-situation.html")
        .output("health-situation.pdf")
        .execute()
})().catch((ex) => {
    console.log("ERROR:", ex)
})

