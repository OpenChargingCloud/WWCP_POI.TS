/*
 * Copyright (c) 2014-2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of WWCP POI TS <https://github.com/OpenChargingCloud/WWCP_POI.TS>
 *
 * Licensed under the Affero GPL license, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.gnu.org/licenses/agpl.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ignoringCase } from './identifications.ts';


// The countries of Styx (`Country`, Illias/I18N/Country.cs), by which an address names its country and an operator or a
// provider its own in its identification: their ISO 3166-1 alpha-2 and alpha-3 codes, their numeric codes, their calling
// codes (ITU-T E.164) and their names, in the order Styx declares them, which decides a calling code of more than one
// country (`TelefonCodes.TryAdd`), e.g. 1 Canada's. One country a line: its alpha-2 code, its alpha-3 code, its numeric
// code, its calling code (0 for none), its names.

const TABLE = `
AF|AFG|4|93|Afghanistan
AX|ALA|248|35818|Åland Islands
AL|ALB|8|355|Albania
DZ|DZA|12|213|Algeria
AS|ASM|16|1684|American Samoa
AD|AND|20|376|Andorra
AO|AGO|24|244|Angola
AI|AIA|660|1264|Anguilla
AQ|ATA|10|0|Antarctica
AG|ATG|28|1268|Antigua and Barbuda
AR|ARG|32|54|Argentina
AM|ARM|51|374|Armenia
AW|ABW|533|297|Aruba
AU|AUS|36|61|Australia
AT|AUT|40|43|Austria
AZ|AZE|31|994|Azerbaijan
BS|BHS|44|1242|Bahamas
BH|BHR|48|973|Bahrain
BD|BGD|50|880|Bangladesh
BB|BRB|52|1246|Barbados
BY|BLR|112|375|Belarus
BE|BEL|56|32|Belgium
BZ|BLZ|84|501|Belize
BJ|BEN|204|229|Benin
BM|BMU|60|1441|Bermuda
BT|BTN|64|975|Bhutan
BO|BOL|68|591|Bolivia
BA|BIH|70|387|Bosnia and Herzegovina
BW|BWA|72|267|Botswana
BV|BVT|74|0|Bouvet Island
BR|BRA|76|55|Brazil
IO|IOT|86|246|British Indian Ocean Territory
VG|VGB|92|1284|British Virgin Islands
BN|BRN|96|673|Brunei Darussalam
BG|BGR|100|359|Bulgaria
BF|BFA|854|226|Burkina Faso
BI|BDI|108|257|Burundi
KH|KHM|116|855|Cambodia
CM|CMR|120|237|Cameroon
CA|CAN|124|1|Canada
CV|CPV|132|238|Cape Verde
KY|CYM|136|1345|Cayman Islands
CF|CAF|140|236|Central African Republic
TD|TCD|148|235|Chad
CL|CHL|152|56|Chile
CN|CHN|156|86|China
CX|CXR|162|61|Christmas Island
CC|CCK|166|61|Cocos (Keeling) Islands
CO|COL|170|57|Colombia
KM|COM|174|269|Comoros
CG|COG|178|242|Congo (Brazzaville)
CD|COD|180|243|Democratic Republic of the Congo
CK|COK|184|682|Cook Islands
CR|CRI|188|506|Costa Rica
CI|CIV|384|225|Côte d'Ivoire
HR|HRV|191|385|Croatia
CU|CUB|192|53|Cuba
CY|CYP|196|357|Cyprus
CZ|CZE|203|420|Czech Republic
CP|CPT|0|0|Clipperton Island
DK|DNK|208|45|Denmark
DJ|DJI|262|253|Djibouti
DM|DMA|212|1767|Dominica
DO|DOM|214|1809|Dominican Republic
EC|ECU|218|593|Ecuador
EG|EGY|818|20|Egypt
SV|SLV|222|503|El Salvador
GQ|GNQ|226|240|Equatorial Guinea
ER|ERI|232|291|Eritrea
EE|EST|233|372|Estonia
ET|ETH|231|251|Ethiopia
FK|FLK|238|500|Falkland Islands (Malvinas)
FO|FRO|234|298|Faroe Islands
FJ|FJI|242|679|Fiji
FI|FIN|246|358|Finland
FR|FRA|250|33|France
GF|GUF|254|594|French Guiana
PF|PYF|258|689|French Polynesia
TF|ATF|260|596|French Southern Territories
GA|GAB|266|241|Gabon
GM|GMB|270|220|Gambia
GE|GEO|268|995|Georgia
DE|DEU|276|49|Germany|Deutschland
GH|GHA|288|233|Ghana
GI|GIB|292|350|Gibraltar
GR|GRC|300|30|Greece
GL|GRL|304|229|Greenland
GD|GRD|308|1473|Grenada
GP|GLP|312|590|Guadeloupe
GU|GUM|316|1671|Guam
GT|GTM|320|502|Guatemala
GG|GGY|831|44|Guernsey
GN|GIN|324|224|Guinea
GW|GNB|624|245|Guinea-Bissau
GY|GUY|328|592|Guyana
HT|HTI|332|509|Haiti
HM|HMD|334|0|Heard Island and Mcdonald Islands
HN|HND|340|504|Honduras
HK|HKG|344|852|Hong Kong
HU|HUN|348|36|Hungary
IS|ISL|352|354|Iceland
IN|IND|356|91|India
ID|IDN|360|62|Indonesia
IR|IRN|364|98|Islamic Republic of Iran
IQ|IRQ|368|964|Iraq
IE|IRL|372|353|Ireland
IM|IMN|833|44|Isle of Man
IL|ISR|376|972|Israel
IT|ITA|380|39|Italy
JM|JAM|388|1876|Jamaica
JP|JPN|392|81|Japan
JE|JEY|832|44|Jersey
JO|JOR|400|962|Jordan
KZ|KAZ|398|76|Kazakhstan
KE|KEN|404|254|Kenya
KI|KIR|296|686|Kiribati
KP|PRK|408|850|Democratic People's Republic of Korea
KR|KOR|410|82|Republic of Korea
KW|KWT|414|965|Kuwait
KG|KGZ|417|996|Kyrgyzstan
LA|LAO|418|856|Lao PDR
LV|LVA|428|371|Latvia
LB|LBN|422|961|Lebanon
LS|LSO|426|266|Lesotho
LR|LBR|430|231|Liberia
LY|LBY|434|218|Libya
LI|LIE|438|423|Liechtenstein
LT|LTU|440|370|Lithuania
LU|LUX|442|352|Luxembourg
MK|MKD|807|389|Republic of Macedonia
MO|MAC|446|835|Macau
MG|MDG|450|261|Madagascar
MW|MWI|454|265|Malawi
MY|MYS|458|60|Malaysia
MV|MDV|462|960|Maldives
ML|MLI|466|223|Mali
MT|MLT|470|356|Malta
MH|MHL|584|692|Marshall Islands
MQ|MTQ|474|596|Martinique
MR|MRT|478|222|Mauritania
MU|MUS|480|230|Mauritius
YT|MYT|175|262|Mayotte
MX|MEX|484|52|Mexico
FM|FSM|583|691|Federated States of Micronesia
MD|MDA|498|373|Moldova
MC|MCO|492|377|Monaco
MN|MNG|496|976|Mongolia
ME|MNE|499|382|Montenegro
MS|MSR|500|1664|Montserrat
MA|MAR|504|212|Morocco
MZ|MOZ|508|258|Mozambique
MM|MMR|104|264|Myanmar
NA|NAM|516|264|Namibia
NR|NRU|520|674|Nauru
NP|NPL|524|977|Nepal
NL|NLD|528|31|Netherlands
AN|ANT|530|1869|Netherlands Antilles
CW|CUW|531|599|Curaçao
NC|NCL|540|687|New Caledonia
NZ|NZL|554|64|New Zealand
NI|NIC|558|505|Nicaragua
NE|NER|562|227|Niger
NG|NGA|566|234|Nigeria
NU|NIU|570|683|Niue
NF|NFK|574|672|Norfolk Island
MP|MNP|580|1670|Northern Mariana Islands
NO|NOR|578|47|Norway
OM|OMN|512|968|Oman
PK|PAK|586|92|Pakistan
PW|PLW|585|680|Palau
PS|PSE|275|970|Palestinian Territory
PA|PAN|591|507|Panama
PG|PNG|598|675|Papua New Guinea
PY|PRY|600|595|Paraguay
PE|PER|604|51|Peru
PH|PHL|608|63|Philippines
PN|PCN|612|64|Pitcairn
PL|POL|616|48|Poland
PT|PRT|620|351|Portugal
PR|PRI|630|1787|Puerto Rico
QA|QAT|634|974|Qatar
RE|REU|638|262|Réunion
RO|ROU|642|40|Romania
RU|RUS|643|7|Russian Federation
RW|RWA|646|250|Rwanda
BL|BLM|652|590|Saint-Barthélemy
SH|SHN|654|290|Saint Helena
KN|KNA|659|1869|Saint Kitts and Nevis
LC|LCA|662|1758|Saint Lucia
MF|MAF|663|590|Saint-Martin (French part)
PM|SPM|666|508|Saint Pierre and Miquelon
VC|VCT|670|1784|Saint Vincent and Grenadines
WS|WSM|882|685|Samoa
SM|SMR|674|378|San Marino
ST|STP|678|239|São Tomé and Príncipe
SA|SAU|682|966|Saudi Arabia
SN|SEN|686|221|Senegal
RS|SRB|688|381|Serbia
SC|SYC|690|248|Seychelles
SL|SLE|694|232|Sierra Leone
SG|SGP|702|65|Singapore
SK|SVK|703|421|Slovakia
SI|SVN|705|386|Slovenia
SB|SLB|90|677|Solomon Islands
SO|SOM|706|252|Somalia
ZA|ZAF|710|27|South Africa
GS|SGS|239|500|South Georgia and the South Sandwich Islands
SS|SSD|728|211|South Sudan
ES|ESP|724|34|Spain
LK|LKA|144|94|Sri Lanka
SD|SDN|736|249|Sudan
SR|SUR|740|597|Suriname
SJ|SJM|744|4779|Svalbard and Jan Mayen Islands
SZ|SWZ|748|268|Swaziland
SE|SWE|752|46|Sweden
CH|CHE|756|41|Switzerland
SY|SYR|760|963|Syrian Arab Republic
TW|TWN|158|886|Taiwan
TJ|TJK|762|992|Tajikistan
TZ|TZA|834|255|United Republic of Tanzania
TH|THA|764|66|Thailand
TL|TLS|626|0|Timor-Leste
TG|TGO|768|228|Togo
TK|TKL|772|690|Tokelau
TO|TON|776|676|Tonga
TT|TTO|780|1868|Trinidad and Tobago
TN|TUN|788|216|Tunisia
TR|TUR|792|90|Turkey
TM|TKM|795|993|Turkmenistan
TC|TCA|796|1649|Turks and Caicos Islands
TV|TUV|798|688|Tuvalu
UG|UGA|800|256|Uganda
UA|UKR|804|380|Ukraine
AE|ARE|784|971|United Arab Emirates
GB|GBR|826|44|United Kingdom
UK|UKI|11826|11144|United Kingdom (invalid)
US|USA|840|1|United States of America
UM|UMI|581|1|United States Minor Outlying Islands
UY|URY|858|598|Uruguay
UZ|UZB|860|998|Uzbekistan
VU|VUT|548|678|Vanuatu
VA|VAT|336|379|Vatican City State (Holy See)
VE|VEN|862|58|Bolivarian Republic of Venezuela
VN|VNM|704|84|Vietnam
VI|VIR|850|1340|Virgin Islands
WF|WLF|876|681|Wallis and Futuna Islands
EH|ESH|732|0|Western Sahara
YE|YEM|887|967|Yemen
ZM|ZMB|894|260|Zambia
ZW|ZWE|716|263|Zimbabwe
YY|YYY|999|999|Testland
`;

/** A country of Styx. */
export interface Country {
    readonly alpha2:   string;
    readonly alpha3:   string;
    readonly numeric:  number;
    readonly calling:  number;
    readonly names:    readonly string[];
}

const ALL: readonly Country[] = TABLE.trim().split('\n').map(line => {
    const [ alpha2 = '', alpha3 = '', numeric = '', calling = '', ...names ] = line.split('|');
    return { alpha2, alpha3, numeric: Number(numeric), calling: Number(calling), names };
});

/** The countries by a key of theirs, each key of the country Styx declares first. */
const by = (keys: (country: Country) => readonly (string | number)[]): ReadonlyMap<string | number, Country> => {
    const countries = new Map<string | number, Country>();
    for (const country of ALL)
        for (const key of keys(country))
            if (!countries.has(key))
                countries.set(key, country);
    return countries;
};

const ALPHA2   = by(country => [ country.alpha2 ]);
const ALPHA3   = by(country => [ country.alpha3 ]);
const NUMERIC  = by(country => [ country.numeric ]);
const CALLING  = by(country => country.calling === 0 ? [] : [ country.calling ]);
const NAMES    = by(country => country.names);

/** The ISO 3166-1 alpha-2 codes of the countries, as `Country.TryParseAlpha2Code` takes them, in upper case. */
export const COUNTRIES: ReadonlySet<string> = new Set(ALL.map(country => country.alpha2));

/** A number as `UInt16.TryParse` reads it: digits, with a plus sign, or zero with a minus sign. */
const uint16 = (text: string): number | undefined =>
    /^(?:\+?[0-9]+|-0+)$/u.test(text) && Number(text) <= 65535 ? Number(text) : undefined;

/**
 * The country a text names as `Country.TryParse` reads it: by its alpha-2 code, its alpha-3 code, both ignoring case, its
 * numeric code, its calling code, or one of its names as written, e.g. `DE`, `deu`, `276`, `49` or `Deutschland`.
 */
export function countryOf(text: string): Country | undefined {

    const code   = ignoringCase(text);
    const number = uint16(text);

    return text === '' ? undefined
                       : ALPHA2.get(code) ?? ALPHA3.get(code) ??
                         (number === undefined ? undefined : NUMERIC.get(number) ?? CALLING.get(number)) ??
                         NAMES.get(text);

}
