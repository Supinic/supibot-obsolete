/*
 (c) 2011-2015, Vladimir Agafonkin
 SunCalc is a JavaScript library for calculating sun/moon position and light phases.
 https://github.com/mourner/suncalc
 sun calculations are based on http://aa.quae.nl/en/reken/zonpositie.html formulas
*/

// Modified and formatted to ES6 standards by Supinic

module.exports = (function () {
	"use strict";

	const PI = Math.PI,
		sin  = Math.sin,
		cos  = Math.cos,
		tan  = Math.tan,
		asin = Math.asin,
		atan = Math.atan2,
		acos = Math.acos,
		rad  = PI / 180,
		e = rad * 23.4397; // obliquity of the Earth

	// date/time constants and conversions
	const dayMs = 1000 * 60 * 60 * 24;
	const J1970 = 2440588;
	const J2000 = 2451545;
	const J0 = 0.0009;

	const toJulian = (date) => date.valueOf() / dayMs - 0.5 + J1970;
	const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
	const toDays = (date) => toJulian(date) - J2000;

	// general calculations for position
	const rightAscension = (l, b) => atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
	const declination = (l, b) => asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));

	const azimuth = (H, phi, dec) =>  atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi));
	const altitude = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));

	const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
	const astroRefraction = (h) => {
		if (h < 0) // the following formula works for positive altitudes only.
			h = 0; // if h = -0.08901179 a div/0 would occur.

		// formula 16.4 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
		// 1.02 / tan(h + 10.26 / (h + 5.10)) h in degrees, result in arc minutes -> converted to rad:
		return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
	};

	// general sun calculations
	const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
	const eclipticLongitude = (M) => {
		const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)); // equation of center
		const P = rad * 102.9372; // perihelion of the Earth
		return M + C + P + PI;
	};
	const sunCoords = (d) => {
		const L = eclipticLongitude(solarMeanAnomaly(d));
		return {
			dec: declination(L, 0),
			ra: rightAscension(L, 0)
		};
	};

	// calculations for sun times
	const hoursLater = (date, h) => new Date(date.valueOf() + h * dayMs / 24);
	const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
	const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
	const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
	const hourAngle = (h, phi, d) => acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d)));

	// returns set time for the given sun altitude
	const getSetJ = (h, lw, phi, dec, n, M, L) => {
		var w = hourAngle(h, phi, dec),
			a = approxTransit(w, lw, n);
		return solarTransitJ(a, M, L);
	};
	const moonCoords = (d) => { // geocentric ecliptic coordinates of the moon
		const L = rad * (218.316 + 13.176396 * d), // ecliptic longitude
			M = rad * (134.963 + 13.064993 * d), // mean anomaly
			F = rad * (93.272 + 13.229350 * d),  // mean distance
			l  = L + rad * 6.289 * sin(M), // longitude
			b  = rad * 5.128 * sin(F),     // latitude
			dt = 385001 - 20905 * cos(M);  // distance to the moon in km

		return {
			ra: rightAscension(l, b),
			dec: declination(l, b),
			dist: dt
		};
	};

	let SunCalc = {};

	// sun times configuration (angle, morning name, evening name)
	SunCalc.times = [
		[-0.833, "sunrise",       "sunset"      ],
		[  -0.3, "sunriseEnd",    "sunsetStart" ],
		[    -6, "dawn",          "dusk"        ],
		[   -12, "nauticalDawn",  "nauticalDusk"],
		[   -18, "nightEnd",      "night"       ],
		[     6, "goldenHourEnd", "goldenHour"  ]
	];
	const times = SunCalc.times;

	// adds a custom time to the times config
	SunCalc.addTime = function (angle, riseName, setName) {
		times.push([angle, riseName, setName]);
	};

	// calculates sun position for a given date and latitude/longitude
	SunCalc.getPosition = (date, lat, lng) => {
		const lw  = rad * -lng,
			phi = rad * lat,
			d = toDays(date),
			c = sunCoords(d),
			H = siderealTime(d, lw) - c.ra;

		return {
			azimuth: azimuth(H, phi, c.dec),
			altitude: altitude(H, phi, c.dec)
		};
	};

	// calculates sun times for a given date and latitude/longitude
	SunCalc.getTimes = (date, lat, lng) => {
		date = new Date(date);
		lat = +lat; lng = +lng;

		const lw = rad * -lng,
			phi = rad * lat,
			d = toDays(date),
			n = julianCycle(d, lw),
			ds = approxTransit(0, lw, n),
			M = solarMeanAnomaly(ds),
			L = eclipticLongitude(M),
			dec = declination(L, 0),
			Jnoon = solarTransitJ(ds, M, L);

		let result = {
			solarNoon: fromJulian(Jnoon),
			nadir: fromJulian(Jnoon - 0.5)
		};

		for (let i = 0, len = times.length; i < len; i++) {
			let time = times[i];
			let Jset = getSetJ(time[0] * rad, lw, phi, dec, n, M, L);
			let Jrise = Jnoon - (Jset - Jnoon);

			result[time[1]] = fromJulian(Jrise);
			result[time[2]] = fromJulian(Jset);
		}

		if (isNaN(result.sunset) || isNaN(result.sunrise)) {
			let counter = 0;
			let position = SunCalc.getPosition(date, lat, lng).altitude;

			if (position < 0) { // Sun is down, we are trying to find the sunrise point
				while (position < 0 && counter++ < 365*24) {
					position = SunCalc.getPosition(date.setHours(date.getHours() + 1), lat, lng).altitude;
				}
				result.arcticSunrise = date;
			}
			else { // Sun is up, we are trying to find the sunset point
				while (position > 0 && counter++ < 365*24) {
					position = SunCalc.getPosition(date.setHours(date.getHours() + 1), lat, lng).altitude;
				}
				result.arcticSunset = date;
			}
		}

		return result;
	};

	// moon calculations, based on http://aa.quae.nl/en/reken/hemelpositie.html formulas
	SunCalc.getMoonPosition = (date, lat, lng) => {
		const lw = rad * -lng,
			phi = rad * lat,
			d = toDays(date),
			c = moonCoords(d),
			H = siderealTime(d, lw) - c.ra,
			// formula 14.1 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
			pa = atan(sin(H), tan(phi) * cos(c.dec) - sin(c.dec) * cos(H));

		let h = altitude(H, phi, c.dec);
		h += astroRefraction(h); // altitude correction for refraction

		return {
			azimuth: azimuth(H, phi, c.dec),
			altitude: h,
			distance: c.dist,
			parallacticAngle: pa
		};
	};

	// calculations for illumination parameters of the moon,
	// based on http://idlastro.gsfc.nasa.gov/ftp/pro/astro/mphase.pro formulas and
	// Chapter 48 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
	SunCalc.getMoonIllumination = (date) => {
		const d = toDays(date || new Date()),
			s = sunCoords(d),
			m = moonCoords(d),
			sdist = 149598000, // distance from Earth to Sun in km
			phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)),
			inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi)),
			angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));

		return {
			fraction: (1 + cos(inc)) / 2,
			phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
			angle: angle
		};
	};

	// calculations for moon rise/set times are based on http://www.stargazing.net/kepler/moonrise.html article
	SunCalc.getMoonTimes = (date, lat, lng, inUTC) => {
		var t = new Date(date);
		if (inUTC) t.setUTCHours(0, 0, 0, 0);
		else t.setHours(0, 0, 0, 0);

		var hc = 0.133 * rad,
			h0 = SunCalc.getMoonPosition(t, lat, lng).altitude - hc,
			h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;

		// go in 2-hour chunks, each time seeing if a 3-point quadratic curve crosses zero (which means rise or set)
		for (var i = 1; i <= 24; i += 2) {
			h1 = SunCalc.getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
			h2 = SunCalc.getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;

			a = (h0 + h2) / 2 - h1;
			b = (h2 - h0) / 2;
			xe = -b / (2 * a);
			ye = (a * xe + b) * xe + h1;
			d = b * b - 4 * a * h1;
			roots = 0;

			if (d >= 0) {
				dx = Math.sqrt(d) / (Math.abs(a) * 2);
				x1 = xe - dx;
				x2 = xe + dx;
				if (Math.abs(x1) <= 1) roots++;
				if (Math.abs(x2) <= 1) roots++;
				if (x1 < -1) x1 = x2;
			}

			if (roots === 1) {
				if (h0 < 0) rise = i + x1;
				else set = i + x1;

			} else if (roots === 2) {
				rise = i + (ye < 0 ? x2 : x1);
				set = i + (ye < 0 ? x1 : x2);
			}

			if (rise && set) break;

			h0 = h2;
		}

		var result = {};

		if (rise) result.rise = hoursLater(t, rise);
		if (set) result.set = hoursLater(t, set);

		if (!rise && !set) result[ye > 0 ? "alwaysUp" : "alwaysDown"] = true;

		return result;
	};

	return SunCalc;
})();
