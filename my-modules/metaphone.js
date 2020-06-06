module.exports = (word, maxPhonemes = Infinity) => {
	if (typeof word !== "string") {
		throw new Error("Input must be a string", word);
	}

    if (typeof maxPhonemes === "number" && (maxPhonemes < 0 || maxPhonemes !== Math.trunc(maxPhonemes))) {
        throw new Error("If set, maxPhonemes must be a non-negative integer", maxPhonemes);
    }

	const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	const vowel = "AEIOU";
	const soft = "EIY";
	const leadingNonAlpha = new RegExp("^[^" + alpha + "]+");

	word = word.toUpperCase().replace(leadingNonAlpha, "");

    let meta = "";
	const traditional = true;

	switch (word[0]) {
		case "A":
			meta += (word[1] === "E") ? word[1] : word[0];
			break;
		case "G":
		case "K":
		case "P":
			if (word[1] === "N") {
				meta += word[1];
                word = word.slice(1);
			}
			break;
		case "W":
			if (word[1] === "R") {
				meta += word[1];
                word = word.slice(1);
			}
            else if (word[1] === "H" || vowel.has(word[1])) {
				meta += "W";
                word = word.slice(1);
			}
			break;
		case "X":
			meta += "S";
			break;
		case "E":
		case "I":
		case "O":
		case "U":
			meta += word[0];
			break;
	}

    word = word.slice(1);

	for (let i = 0; i < word.length && meta.length < maxPhonemes; i++) { 
		const cc = word.charAt(i);
		const nc = word.charAt(i + 1);
		const pc = word.charAt(i - 1);
		const nnc = word.charAt(i + 2);

		if (cc === pc && cc !== "C") {
			continue;
		}

		switch (cc) {
			case "B":
				if (pc !== "M") {
					meta += cc;
				}
				break;
			case "C":
				if (soft.has(nc)) {
					if (nc === "I" && nnc === "A") {
						meta += "X";
					} 
                    else if (pc !== "S") {
						meta += "S";
					}
				}
                else if (nc === "H") {
					meta += (!traditional && (nnc === "R" || pc === "S")) ? "K" : "X";
					i++;
				} 
                else {
					meta += "K";
				}
				break;
			case "D":
				if (nc === "G" && soft.has(nnc)) {
					meta += "J";
					i++;
				}
                else {
					meta += "T";
				}
				break;
			case "G":
				if (nc === "H") {
					if (!"BDH".has(word.charAt(i - 3)) && word.charAt(i - 4) !== "H") {
						meta += "F";
						i++;
					}
				}
                else if (nc === "N") {
                    if (alpha.has(nnc) && word.substr(i + 1, 3) !== "NED") {
						meta += "K";
					}
				}
                else if (soft.has(nc) && pc !== "G") {
					meta += "J";
				}
                else {
					meta += "K";
				}
				break;
			case "H":
				if (vowel.has(nc) && !"CGPST".has(pc)) {
					meta += cc;
				}
				break;
			case "K":
				if (pc !== "C") {
					meta += "K";
				}
				break;
			case "P":
				meta += (nc === "H") ? "F" : cc;
				break;
			case "Q":
				meta += "K";
				break;
			case "S":
				if (nc === "I" && "AO".has(nnc)) {
					meta += "X";
				} 
                else if (nc === "H") {
					meta += "X";
					i++;
				} 
                else if (!traditional && word.substr(i + 1, 3) === "CHW") {
					meta += "X";
					i += 2;
				} 
                else {
					meta += "S";
				}
				break;
			case "T":
				if (nc === "I" && "AO".has(nnc)) {
					meta += "X";
				} 
                else if (nc === "H") {
					meta += "0";
					i++;
				} 
                else if (word.substr(i + 1, 2) !== "CH") {
					meta += "T";
				}
				break;
			case "V":
				meta += "F";
				break;
			case "W":
			case "Y":
				if (vowel.has(nc)) {
					meta += cc;
				}
				break;
			case "X":
				meta += "KS";
				break;
			case "Z":
				meta += "S";
				break;
			case "F":
			case "J":
			case "L":
			case "M":
			case "N":
			case "R":
				meta += cc;
				break;
		}
	}

	return meta;
};