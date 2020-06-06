module.exports = (function (ParserRSS, Utils) {
	"use strict";

	const Choices = {
		random: Symbol("rand"),
		sequential: Symbol("seq"),
		static: Symbol("stat")
	};
	const Type = {
		rss: Symbol("rss")
	};

	const Parser = ParserRSS || new (require("rss-parser"))();
	const definition = [
		{ 	
			helpers: ["kalastelija01", "leppunen"],
			code: "fi",
		 	language: "finnish", 
			type: Type.rss, 
			choice: Choices.random, 
			url: "https://www.iltalehti.fi/rss/", 
			sources: [
		 		"uutiset.xml",
				"viihde.xml", 
				"digi.xml",
		 	]
		},
		{
			helpers: [],
			code: "vn",
			language: "vietnamese",
			type: Type.rss,
			choice: Choices.random,
			url: "https://www.bbc.com/vietnamese/",
			sources: [
				"world/index.xml",
				"vietnam/index.xml",
				"business/index.xml",
				"english/index.xml"
			]
		},
		{
			helpers: [],
			code: "ug",
			language: "swahili",
			type: Type.rss,
			choice: Choices.random,
			url: "https://www.bukedde.co.ug/feed/rss/category/",
			sources: [
				"amawulire/buganda",
				"emboozi",
				"amawulire/bugwanjuba",
				"bukedde-ku-ssande/eby-eddiini"
			]
		},
		{
			helpers: ["<unknown guy from nymns chat>"],
			code: "kz",
			language: "kazakhstani",
			type: Type.rss,
			choice: Choices.random,
			url: "",
			sources: [
				"http://www.minfin.gov.kz/irj/go/km/docs/documents/%d0%9c%d0%b8%d0%bd%d1%84%d0%b8%d0%bd_new/Service%20Folders/RSS/%d0%9b%d0%b5%d0%bd%d1%82%d0%b0%20RSS/%d0%90%d0%bd%d0%b0%d0%bb%d0%b8%d1%82%d0%b8%d0%ba%d0%b0/ru/rss",
				"https://janaforum.republican/feed/"
			]
		},
		{
			helpers: ["<unknown guy from nymns chat>"],
			code: "es",
			language: "spanish",
			type: Type.rss,
			choice: Choices.random,
			url: "https://www.abc.es/rss/feeds/abc",
			sources: [
				"_Economia.xml",
				"_opinioncompleto.xml",
				"_Cultura.xml",
				"_EspanaEspana.xml",
				"Portada.xml"
			]
		},
		{			
			helpers: ["namtheweebs"],
			code: "cl",
			language: "spanish",
			type: Type.rss,
			choice: Choices.random,
			url: "https://www.cooperativa.cl/noticias/site/tax/port/",
			sources: [
				"all/rss____1.xml"
			]
		},
		{
			helpers: ["kawaqa"],
			code: "is",
			language: "icelandic",
			type: Type.rss,
			choice: Choices.random,
			url: "https://www.ruv.is/rss/",
			sources: [
				"frettir",
				"innlent",
				"erlent"
			]
		},
		{ 	
			helpers: ["infinitegachi"],
			code: "rs",
		 	language: "serbian", 
			type: Type.rss, 
			choice: Choices.random, 
			url: "https://rs.n1info.com/rss/250/", 
			sources: [
		 		"Najnovije"
		 	]
		}
	];

	let sequences = {};
	definition.forEach(lang => {
		sequences[lang.code] = 0;
	});

	return class ExtraNews {
		static quickCheck (rawLang) {
			const lang = rawLang.toLowerCase().trim();
			return !!definition.some(i => i.code === lang || i.language === lang);
		}

		static check (rawLang) {
			const lang = rawLang.toLowerCase().trim();
			return definition.find(i => i.code === lang || i.language === lang) || null;
		}

		static async fetch (lang) {
			const def = this.check(lang);
			if (def === null) {
				throw new Error("Unsupported extra lanaguage", lang);
			}

			if (def.type !== Type.rss) {
				throw new Error("Not yet supported news type", def.type);
			}

			let targetURL = null;
			if (def.choice === Choices.random) {
				targetURL = def.url + Utils.randArray(def.sources);
			}
			else if (def.choice === Choices.sequential) {
				const index = sequences[def.code] % def.sources.length;
				targetURL = def.url + def.sources[index];
				sequences[def.code]++;
			}
			else if (def.choice === Choices.static) {
				targetURL = def.url;
			}
			else {
				throw new Error("Not yet supported choice type", def.choice);
			}

			console.log("Extra news URL:", targetURL);

			const feed = await Parser.parseURL(targetURL);	
			return Utils.randArray(feed.items).title;
		}
	};
});