/**
 * Paragon data structure and constraints
 * Auto-generated from paragons.csv
 * Source: https://docs.google.com/spreadsheets/d/1lgEI7rJRDuhOT1QXz_xSxJA1H0VREzEmDzXwHKJrcM8/edit?gid=1332236618
 * 
 * To regenerate this file, run: node scripts/parse-paragons.js
 */

export interface ParagonData {
  name: string;
  goodBrigade: string;
  evilBrigade: string;
  /** Number of cards required from primary good brigade */
  primaryGood: number;
  /** Number of cards required from other good brigades */
  otherGood: number;
  /** Number of neutral cards allowed */
  neutral: number;
  /** Number of cards required from primary evil brigade */
  primaryEvil: number;
  /** Number of cards required from other evil brigades */
  otherEvil: number;
  /** Total deck size (always 50 for Paragon format) */
  totalCards: number;
  /** Paragon title */
  paragonTitle: string;
  /** Paragon ability text */
  ability: string;
  /** Biblical reference */
  reference: string;
  /** Bible verse text */
  verse: string;
}

export const PARAGONS: ParagonData[] = [
  {
    "name": "Abraham",
    "goodBrigade": "Blue",
    "evilBrigade": "Black",
    "primaryGood": 11,
    "otherGood": 14,
    "neutral": 5,
    "primaryEvil": 10,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Faith",
    "ability": "If you play a patriarch, take from deck or Reserve the first from this list you have not yet taken this game: a patriarch, a judge, a human king, a good Dominant. Limit once per turn.",
    "reference": "Genesis 15:5-6",
    "verse": "And He took him outside and said, “Now look toward the heavens and count the stars, if you are able to count them.” And He said to him, “So shall your descendants be.” Then he believed in the Lord; and He credited it to him as righteousness."
  },
  {
    "name": "Judah",
    "goodBrigade": "Blue",
    "evilBrigade": "Brown",
    "primaryGood": 12,
    "otherGood": 12,
    "neutral": 5,
    "primaryEvil": 11,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Substitution",
    "ability": "If your human is harmed, you may capture your patriarch instead. If you do, you may take a human king from deck. Limit once per turn.",
    "reference": "Genesis 44:32-33",
    "verse": "For your servant accepted responsibility for the boy from my father, saying, ‘If I do not bring him back to you, then my father can let me take the blame forever.’ So now, please let your servant remain as a slave to my lord instead of the boy, and let the boy go up with his brothers."
  },
  {
    "name": "Eve",
    "goodBrigade": "Blue",
    "evilBrigade": "Crimson",
    "primaryGood": 11,
    "otherGood": 13,
    "neutral": 6,
    "primaryEvil": 10,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Motherhood",
    "ability": "If your female wins a battle, you may play a human from Reserve. While you have board advantage, if your female Hero wins a battle, you may take a good Dominant from deck.",
    "reference": "Genesis 3:15",
    "verse": "“And I will make enemies of you and the woman, and of your offspring and her Descendant; He shall bruise you on the head, and you shall bruise Him on the heel.”"
  },
  {
    "name": "Rachel",
    "goodBrigade": "Blue",
    "evilBrigade": "Gray",
    "primaryGood": 13,
    "otherGood": 12,
    "neutral": 4,
    "primaryEvil": 11,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Favor",
    "ability": "If your patriarch is blocked, opponent must play a Hero from your deck. If your Syrian enters battle, opponent must shuffle a Genesis Enhancement from your discard pile.",
    "reference": "Genesis 30:22-23",
    "verse": "Then God remembered Rachel, and God listened to her and opened her womb. So she conceived and gave birth to a son, and said, “God has taken away my disgrace.”"
  },
  {
    "name": "Reuben",
    "goodBrigade": "Blue",
    "evilBrigade": "Orange",
    "primaryGood": 12,
    "otherGood": 13,
    "neutral": 4,
    "primaryEvil": 11,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Rescue",
    "ability": "While your character is in battle, if opponent underdecks a card from hand, you may release a captured character or draw 1.",
    "reference": "Genesis 37:21-22",
    "verse": "But Reuben heard this and rescued him out of their hands by saying, “Let’s not take his life.” Then Reuben said to them, “Shed no blood. Throw him into this pit... but do not lay a hand on him”—so that later he might rescue him out of their hands, to return him to his father."
  },
  {
    "name": "Joseph",
    "goodBrigade": "Blue",
    "evilBrigade": "Pale Green",
    "primaryGood": 13,
    "otherGood": 11,
    "neutral": 6,
    "primaryEvil": 11,
    "otherEvil": 9,
    "totalCards": 50,
    "paragonTitle": "Paragon of Forgiveness",
    "ability": "If your Egyptian captures a character, you may take a son of Jacob from deck, Reserve, or discard pile. Protect your Genesis Fortresses from opponents.",
    "reference": "Genesis 45:4-5",
    "verse": "Then Joseph said to his brothers, “Please come closer to me.” And they came closer. And he said, “I am your brother Joseph, whom you sold to Egypt. Now do not be grieved or angry with yourselves because you sold me here, for God sent me ahead of you to save lives.”"
  },
  {
    "name": "Titus",
    "goodBrigade": "Clay",
    "evilBrigade": "Black",
    "primaryGood": 12,
    "otherGood": 12,
    "neutral": 5,
    "primaryEvil": 11,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Order",
    "ability": "Each upkeep, if you have no redeemed souls, each player must play a N.T. human from deck. If your Greek character wins a battle, choose any number of players: they each draw 1.",
    "reference": "Titus 1:4-5",
    "verse": "To Titus, my true son in a common faith: Grace and peace from God the Father and Christ Jesus our Savior. For this reason I left you in Crete, that you would set in order what remains and appoint elders in every city as I directed you."
  },
  {
    "name": "Zadok",
    "goodBrigade": "Clay",
    "evilBrigade": "Brown",
    "primaryGood": 13,
    "otherGood": 11,
    "neutral": 6,
    "primaryEvil": 9,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Dedication",
    "ability": "While you control a high priest, your enhancements cannot be prevented.",
    "reference": "I Kings 1:38-39",
    "verse": "So Zadok the priest... went down and had Solomon ride on King David’s mule, and brought him to Gihon. And Zadok the priest then took the horn of oil from the tent and anointed Solomon. Then they blew the trumpet, and all the people said, “Long live King Solomon!”"
  },
  {
    "name": "Phinehas",
    "goodBrigade": "Clay",
    "evilBrigade": "Crimson",
    "primaryGood": 13,
    "otherGood": 12,
    "neutral": 5,
    "primaryEvil": 11,
    "otherEvil": 9,
    "totalCards": 50,
    "paragonTitle": "Paragon of Zeal",
    "ability": "Characters you control have first strike. If you banish an Artifact or discard an opponent's Evil Character, you may draw 1.",
    "reference": "Numbers 25:10-11",
    "verse": "Then the Lord spoke to Moses, saying, “Phinehas the son of Eleazar, the son of Aaron the priest, has averted My wrath from the sons of Israel in that he was jealous with My jealousy among them, so that I did not destroy the sons of Israel in My jealousy.”"
  },
  {
    "name": "Aaron",
    "goodBrigade": "Clay",
    "evilBrigade": "Gray",
    "primaryGood": 11,
    "otherGood": 13,
    "neutral": 6,
    "primaryEvil": 10,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Priesthood",
    "ability": "Your priests cannot be prevented unless an idol is in play. If your Tabernacle priest wins a battle, you may take a Tabernacle priest or Tabernacle Artifact from deck or Reserve.",
    "reference": "Exodus 28:1-2",
    "verse": "“Then bring forward to yourself your brother Aaron, and his sons with him, from among the sons of Israel, to serve as priest to Me—Aaron, Nadab and Abihu, Eleazar and Ithamar, Aaron’s sons. And you shall make holy garments for Aaron your brother, for glory and for beauty.”"
  },
  {
    "name": "Claudia",
    "goodBrigade": "Clay",
    "evilBrigade": "Orange",
    "primaryGood": 11,
    "otherGood": 14,
    "neutral": 4,
    "primaryEvil": 9,
    "otherEvil": 12,
    "totalCards": 50,
    "paragonTitle": "Paragon of Hospitality",
    "ability": "Protect N.T. Heroes in territory from harm. Your characters' band abilities cannot be interrupted.",
    "reference": "II Timothy 4:21-22",
    "verse": "Make every effort to come before winter. Eubulus greets you, also Pudens, Linus, Claudia, and all the brothers and sisters. The Lord be with your spirit. Grace be with you."
  },
  {
    "name": "Melchizedek",
    "goodBrigade": "Clay",
    "evilBrigade": "Pale Green",
    "primaryGood": 12,
    "otherGood": 13,
    "neutral": 4,
    "primaryEvil": 11,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Blessing",
    "ability": "While you control a king, your Genesis characters are protected from opponents' Artifacts. If your priest wins a battle, you may shuffle a Genesis card from discard pile.",
    "reference": "Genesis 14:18-19",
    "verse": "And Melchizedek the king of Salem brought out bread and wine; now he was a priest of God Most High. And he blessed him and said, “Blessed be Abram of God Most High, Possessor of heaven and earth.”"
  },
  {
    "name": "Rahab",
    "goodBrigade": "Gold",
    "evilBrigade": "Black",
    "primaryGood": 13,
    "otherGood": 11,
    "neutral": 6,
    "primaryEvil": 11,
    "otherEvil": 9,
    "totalCards": 50,
    "paragonTitle": "Paragon of Kindness",
    "ability": "If your human Canaanite is harmed, you may underdeck a good Joshua card from hand instead. Limit once per turn. If your Joshua Hero attacks, you may bounce a character you own.",
    "reference": "Joshua 2:11-12",
    "verse": "...for the Lord your God, He is God in heaven above and on earth below. Now then, please swear to me by the Lord, since I have dealt kindly with you, that you also will deal kindly with my father’s household, and give me a pledge of truth."
  },
  {
    "name": "Joshua",
    "goodBrigade": "Gold",
    "evilBrigade": "Brown",
    "primaryGood": 11,
    "otherGood": 14,
    "neutral": 4,
    "primaryEvil": 9,
    "otherEvil": 12,
    "totalCards": 50,
    "paragonTitle": "Paragon of Obedience",
    "ability": "If you play a Fortress, you may take a Joshua enhancement of matching alignment from Reserve.",
    "reference": "Joshua 1:16-17",
    "verse": "They answered Joshua, saying, “All that you have commanded us we will do, and wherever you send us we will go. Just as we obeyed Moses in all things, so we will obey you; only may the Lord your God be with you as He was with Moses.”"
  },
  {
    "name": "Caleb",
    "goodBrigade": "Gold",
    "evilBrigade": "Crimson",
    "primaryGood": 12,
    "otherGood": 12,
    "neutral": 6,
    "primaryEvil": 9,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Inheritance",
    "ability": "If your warrior wins a battle, you may banish opponent's character of opposite alignment or take a card of matching alignment from opponent's Reserve.",
    "reference": "Joshua 14:13-14",
    "verse": "So Joshua blessed him and gave Hebron to Caleb the son of Jephunneh as an inheritance. Therefore, Hebron became the inheritance of Caleb the son of Jephunneh the Kenizzite to this day, because he followed the Lord God of Israel fully."
  },
  {
    "name": "Deborah",
    "goodBrigade": "Gold",
    "evilBrigade": "Gray",
    "primaryGood": 11,
    "otherGood": 13,
    "neutral": 5,
    "primaryEvil": 9,
    "otherEvil": 12,
    "totalCards": 50,
    "paragonTitle": "Paragon of Justice",
    "ability": "Your Judges characters may use Judges enhancements. While your female Hero is in battle, protect your Heroes from evil warriors.",
    "reference": "Judges 4:4-5",
    "verse": "Now Deborah, a prophetess, the wife of Lappidoth, was judging Israel at that time. She used to sit under the palm tree of Deborah between Ramah and Bethel in the hill country of Ephraim; and the sons of Israel went up to her for judgment."
  },
  {
    "name": "Gideon",
    "goodBrigade": "Gold",
    "evilBrigade": "Orange",
    "primaryGood": 12,
    "otherGood": 13,
    "neutral": 4,
    "primaryEvil": 10,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Humility",
    "ability": "Enhancements used by your meek characters cannot be prevented and are regardless of protect abilities.",
    "reference": "Judges 6:15-16",
    "verse": "But he said to Him, “O Lord, how am I to save Israel? Behold, my family is the least in Manasseh, and I am the youngest in my father’s house.” Yet the Lord said to him, “I will certainly be with you, and you will defeat Midian as one man.”"
  },
  {
    "name": "Jephthah",
    "goodBrigade": "Gold",
    "evilBrigade": "Pale Green",
    "primaryGood": 13,
    "otherGood": 12,
    "neutral": 5,
    "primaryEvil": 11,
    "otherEvil": 9,
    "totalCards": 50,
    "paragonTitle": "Paragon of Deliverance",
    "ability": "If you discard a Hero from a deck, each opponent must discard an evil card from hand or territory. Limit once per phase. If you play a judge, you may topdeck a good card from Reserve.",
    "reference": "Judges 11:11",
    "verse": "Then Jephthah went with the elders of Gilead, and the people made him head and leader over them; and Jephthah spoke all his words before the Lord at Mizpah."
  },
  {
    "name": "Samuel",
    "goodBrigade": "Green",
    "evilBrigade": "Black",
    "primaryGood": 11,
    "otherGood": 14,
    "neutral": 5,
    "primaryEvil": 9,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Leadership",
    "ability": "If your I Samuel character in battle is harmed, you may add your I Samuel character with a different brigade to battle.",
    "reference": "I Samuel 7:15-17",
    "verse": "Now Samuel judged Israel all the days of his life. And he used to go annually on a circuit to Bethel, Gilgal, and Mizpah, and he judged Israel in all these places. Then he would make his return to Ramah... and there he built an altar to the Lord."
  },
  {
    "name": "Jeremiah",
    "goodBrigade": "Green",
    "evilBrigade": "Brown",
    "primaryGood": 12,
    "otherGood": 12,
    "neutral": 5,
    "primaryEvil": 10,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Lament",
    "ability": "If your prophet is captured or fails a rescue attempt, reserve two Enhancements from discard pile and take an evil Enhancement with a Jeremiah or Lamentations reference from Reserve. Limit once per turn.",
    "reference": "Jeremiah 7:1-2",
    "verse": "The word that came to Jeremiah from the Lord, saying, “Stand at the gate of the Lord’s house and proclaim there this word, and say, ‘Hear the word of the Lord, all you of Judah, who enter by these gates to worship the Lord!’”"
  },
  {
    "name": "David",
    "goodBrigade": "Green",
    "evilBrigade": "Crimson",
    "primaryGood": 11,
    "otherGood": 13,
    "neutral": 6,
    "primaryEvil": 10,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Bravery",
    "ability": "Each upkeep, if you control a I Samuel card and a II Samuel card, you may take a card with David in the title from deck, Reserve, or discard pile.",
    "reference": "I Samuel 17:37",
    "verse": "And David said, “The Lord who saved me from the paw of the lion and the paw of the bear, He will save me from the hand of this Philistine.” So Saul said to David, “Go, and may the Lord be with you.”"
  },
  {
    "name": "Hannah",
    "goodBrigade": "Green",
    "evilBrigade": "Gray",
    "primaryGood": 13,
    "otherGood": 12,
    "neutral": 4,
    "primaryEvil": 10,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Prayer",
    "ability": "If your Hero withdraws from battle, you may add a Hero of matching brigade from deck to battle. Your abilities that target an opponent's hand are regardless of protect abilities.",
    "reference": "I Samuel 1:26-27",
    "verse": "And she said, “Pardon me, my lord! As your soul lives, my lord, I am the woman who stood here beside you, praying to the Lord. For this boy I prayed, and the Lord has granted me my request which I asked of Him.”"
  },
  {
    "name": "Malachi",
    "goodBrigade": "Green",
    "evilBrigade": "Orange",
    "primaryGood": 12,
    "otherGood": 13,
    "neutral": 4,
    "primaryEvil": 11,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Warning",
    "ability": "If your minor prophet is blocked, you may reveal your hand to draw 1. If your evil character wins a battle, you may discard it to take a postexilic Hero and/or a good O.T. Fortress from discard pile.",
    "reference": "Malachi 3:5",
    "verse": "“Then I will come near to you for judgment; and I will be a swift witness against the sorcerers, the adulterers, against those who swear falsely, those who oppress ... and those who turn away the stranger from justice and do not fear Me,” says the Lord of armies."
  },
  {
    "name": "Nathan",
    "goodBrigade": "Green",
    "evilBrigade": "Pale Green",
    "primaryGood": 13,
    "otherGood": 11,
    "neutral": 6,
    "primaryEvil": 9,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Rebuke",
    "ability": "If your lone prophet attacks (or your human king blocks), reveal the bottom card of each player's deck: discard the evil cards. If one or more are discarded, you may draw 1.",
    "reference": "II Samuel 12:7",
    "verse": "Nathan then said to David, “You yourself are the man! This is what the Lord, the God of Israel says: ‘It is I who anointed you as king over Israel, and it is I who rescued you from the hand of Saul.’”"
  },
  {
    "name": "Jonathan",
    "goodBrigade": "Purple",
    "evilBrigade": "Black",
    "primaryGood": 13,
    "otherGood": 12,
    "neutral": 4,
    "primaryEvil": 9,
    "otherEvil": 12,
    "totalCards": 50,
    "paragonTitle": "Paragon of Loyalty",
    "ability": "While you control multiple warriors in battle, toss all enhancements with banish or negated in the special ability.",
    "reference": "I Samuel 20:16-17",
    "verse": "So Jonathan made a covenant with the house of David, saying, “May the Lord demand it from the hands of David’s enemies.” And Jonathan made David vow again because of his love for him, because he loved him as he loved his own life."
  },
  {
    "name": "Esther",
    "goodBrigade": "Purple",
    "evilBrigade": "Brown",
    "primaryGood": 13,
    "otherGood": 11,
    "neutral": 6,
    "primaryEvil": 11,
    "otherEvil": 9,
    "totalCards": 50,
    "paragonTitle": "Paragon of Courage",
    "ability": "While your lone queen is in battle, protect Lost Souls from evil cards. If your Persian wins a battle, you may take a card from opponent's Reserve.",
    "reference": "Esther 4:16",
    "verse": "“Go, gather all the Jews who are found in Susa, and fast for me; do not eat or drink for three days, night or day. I and my attendants also will fast in the same way. And then I will go in to the king, which is not in accordance with the law; and if I perish, I perish.”"
  },
  {
    "name": "Abigail",
    "goodBrigade": "Purple",
    "evilBrigade": "Crimson",
    "primaryGood": 11,
    "otherGood": 14,
    "neutral": 4,
    "primaryEvil": 11,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Wisdom",
    "ability": "If your human is harmed by a player, you may give an animal from Reserve to that player's territory instead. Limit once per turn. If your royal Hero attacks, you may bounce an animal.",
    "reference": "I Samuel 25:32-33",
    "verse": "Then David said to Abigail, “Blessed be the Lord God of Israel, who sent you this day to meet me, and blessed be your discernment, and blessed be you, who have kept me this day from bloodshed and from avenging myself by my own hand.”"
  },
  {
    "name": "Abishai",
    "goodBrigade": "Purple",
    "evilBrigade": "Gray",
    "primaryGood": 12,
    "otherGood": 12,
    "neutral": 6,
    "primaryEvil": 9,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Might",
    "ability": "Protect your equipped warriors from opponents' Artifacts. If your warrior wins a battle, you may shuffle a weapon from discard pile and/or a weapon from Reserve.",
    "reference": "II Samuel 23:18-19",
    "verse": "Now Abishai, the brother of Joab, the son of Zeruiah, was chief of the thirty. And he swung his spear against three hundred and killed them, and had a name as well as the three. He was the most honored among the thirty, so he became their commander..."
  },
  {
    "name": "Peter",
    "goodBrigade": "Purple",
    "evilBrigade": "Orange",
    "primaryGood": 11,
    "otherGood": 13,
    "neutral": 5,
    "primaryEvil": 10,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Boldness",
    "ability": "Your Gospel characters cannot be prevented and may use N.T. enhancements.",
    "reference": "Matthew 16:15-17",
    "verse": "He said to them, “But who do you yourselves say that I am?” Simon Peter answered, “You are the Christ, the Son of the living God.” And Jesus said to him, “Blessed are you, Simon Barjona, because flesh and blood did not reveal this to you, but My Father who is in heaven.”"
  },
  {
    "name": "Benaiah",
    "goodBrigade": "Purple",
    "evilBrigade": "Pale Green",
    "primaryGood": 12,
    "otherGood": 13,
    "neutral": 5,
    "primaryEvil": 10,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Prowess",
    "ability": "Your human warriors may use weapons (regardless of brigade). If you discard an opponent's warrior, you may take a weapon that was equipped to it.",
    "reference": "II Samuel 23:21",
    "verse": "And he killed an Egyptian, an impressive man. Now the Egyptian had a spear in his hand, but he went down to him with a club and snatched the spear from the Egyptian’s hand, and killed him with his own spear."
  },
  {
    "name": "Zechariah",
    "goodBrigade": "Silver",
    "evilBrigade": "Black",
    "primaryGood": 13,
    "otherGood": 12,
    "neutral": 5,
    "primaryEvil": 9,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Visions",
    "ability": "If you play an enhancement with a band ability, you may add a character of matching brigade from Reserve to battle. Each upkeep, you may reserve a generic angel from discard pile.",
    "reference": "Zechariah 1:9-10",
    "verse": "Then I said, “What are these, my lord?” And the angel who was speaking with me said to me, “I will show you what these are.” And the man who was standing among the myrtle trees responded and said, “These are the ones whom the Lord has sent to patrol the earth.”"
  },
  {
    "name": "Job",
    "goodBrigade": "Silver",
    "evilBrigade": "Brown",
    "primaryGood": 13,
    "otherGood": 11,
    "neutral": 5,
    "primaryEvil": 9,
    "otherEvil": 12,
    "totalCards": 50,
    "paragonTitle": "Paragon of Patience",
    "ability": "Restrict players from attacking during the first round of the game. While you control exactly one human Hero, protect your characters from opponents' band, banish, capture, and convert abilities.",
    "reference": "Job 2:3",
    "verse": "The Lord said to Satan, “Have you considered My servant Job? For there is no one like him on the earth, a blameless and upright man fearing God and turning away from evil. And he still holds firm to his integrity, although you incited Me against him to ruin him without cause.”"
  },
  {
    "name": "Ezekiel",
    "goodBrigade": "Silver",
    "evilBrigade": "Crimson",
    "primaryGood": 12,
    "otherGood": 12,
    "neutral": 6,
    "primaryEvil": 11,
    "otherEvil": 9,
    "totalCards": 50,
    "paragonTitle": "Paragon of Prophecy",
    "ability": "If your Babylonian blocks (or your Ezekiel Hero is blocked), opponent may topdeck an evil card from hand. If they do not, you may resurrect a Hero or take an Ezekiel Enhancement from deck.",
    "reference": "Ezekiel 1:2-3",
    "verse": "On the fifth of the month in the fifth year of King Jehoiachin’s exile, the word of the Lord came expressly to Ezekiel the priest, son of Buzi, in the land of the Chaldeans by the river Chebar; and there the hand of the Lord came upon him."
  },
  {
    "name": "Jacob",
    "goodBrigade": "Silver",
    "evilBrigade": "Gray",
    "primaryGood": 12,
    "otherGood": 13,
    "neutral": 4,
    "primaryEvil": 9,
    "otherEvil": 12,
    "totalCards": 50,
    "paragonTitle": "Paragon of Perserverance",
    "ability": "If your O.T. angel wins a battle, you may take a patriarch from deck. If your human is harmed or defeated by an opponent, you may underdeck it instead.",
    "reference": "Genesis 32:27-28",
    "verse": "So he said to him, “What is your name?” And he said, “Jacob.” Then he said, “Your name shall no longer be Jacob, but Israel; for you have contended with God and with men, and have prevailed.”"
  },
  {
    "name": "John",
    "goodBrigade": "Silver",
    "evilBrigade": "Orange",
    "primaryGood": 11,
    "otherGood": 14,
    "neutral": 4,
    "primaryEvil": 9,
    "otherEvil": 12,
    "totalCards": 50,
    "paragonTitle": "Paragon of Witness",
    "ability": "If your lone angel or demon enters battle, it may band to your N.T. human.",
    "reference": "John 21:24-25",
    "verse": "This is the disciple who is testifying about these things and wrote these things, and we know that his testimony is true. But there are also many other things which Jesus did, which, if they were written in detail, ...the world itself would not contain the books that would be written."
  },
  {
    "name": "Isaiah",
    "goodBrigade": "Silver",
    "evilBrigade": "Pale Green",
    "primaryGood": 11,
    "otherGood": 13,
    "neutral": 6,
    "primaryEvil": 10,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Hope",
    "ability": "If you play a dual icon Enhancement, you may shuffle it. Limit once per turn. If your Isaiah character wins a battle, you may take a dual icon Enhancement from deck.",
    "reference": "Isaiah 6:7-8",
    "verse": "He touched my mouth with it and said, “Behold, this has touched your lips; and your guilt is taken away and atonement is made for your sin.” Then I heard the voice of the Lord, saying, “Whom shall I send, and who will go for Us?” Then I said, “Here am I. Send me!”"
  },
  {
    "name": "Boaz",
    "goodBrigade": "White",
    "evilBrigade": "Black",
    "primaryGood": 12,
    "otherGood": 13,
    "neutral": 4,
    "primaryEvil": 10,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Generosity",
    "ability": "If you draw because of your good ability, each other player must draw 1, and you may draw 1. While opponent has hand advantage, Ruth enhancements used by your Ruth characters cannot be negated.",
    "reference": "Ruth 2:15-16",
    "verse": "When she got up to glean, Boaz commanded his servants, saying, “Let her glean even among the sheaves, and do not insult her. Also you are to purposely slip out for her some grain from the bundles and leave it so that she may glean, and do not rebuke her.”"
  },
  {
    "name": "Moses",
    "goodBrigade": "White",
    "evilBrigade": "Brown",
    "primaryGood": 12,
    "otherGood": 12,
    "neutral": 6,
    "primaryEvil": 10,
    "otherEvil": 10,
    "totalCards": 50,
    "paragonTitle": "Paragon of Command",
    "ability": "Increase your hand size by 2. If your wilderness human wins a battle, you may draw 1.",
    "reference": "Exodus 24:12",
    "verse": "Now the Lord said to Moses, “Come up to Me on the mountain and stay there, and I will give you the stone tablets with the Law and the commandments which I have written for their instruction.”"
  },
  {
    "name": "Chenaniah",
    "goodBrigade": "White",
    "evilBrigade": "Crimson",
    "primaryGood": 11,
    "otherGood": 14,
    "neutral": 4,
    "primaryEvil": 10,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Song",
    "ability": "During battle, if you control 3 or more Enhancements (except weapons), you may bounce your Enhancement. Limit once per battle. Your musicians may use enhancements involving music.",
    "reference": "I Chronicles 15:22",
    "verse": "Chenaniah, chief of the Levites, was in charge of the singing; he gave instruction in singing because he was skillful."
  },
  {
    "name": "Ruth",
    "goodBrigade": "White",
    "evilBrigade": "Gray",
    "primaryGood": 13,
    "otherGood": 12,
    "neutral": 5,
    "primaryEvil": 11,
    "otherEvil": 9,
    "totalCards": 50,
    "paragonTitle": "Paragon of Devotion",
    "ability": "If your Moabite enters battle, you may take a Ruth card from Reserve. While all your Heroes in battle are Ruth Heroes, protect them from opponents' withdraw, bounce, and banish abilities.",
    "reference": "Ruth 1:16",
    "verse": "But Ruth said, “Do not plead with me to leave you or to turn back from following you; for where you go, I will go, and where you sleep, I will sleep. Your people shall be my people, and your God, my God.”"
  },
  {
    "name": "Daniel",
    "goodBrigade": "White",
    "evilBrigade": "Orange",
    "primaryGood": 11,
    "otherGood": 13,
    "neutral": 6,
    "primaryEvil": 9,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Insight",
    "ability": "If you play a Daniel character, you may look at a hand. Regardless of protect abilities. Limit once per turn.",
    "reference": "Daniel 2:27-28",
    "verse": "Daniel answered before the king and said, “As for the secret about which the king has inquired, neither wise men, sorcerers, soothsayer priests, nor diviners are able to declare it to the king. However, there is a God in heaven who reveals secrets...”"
  },
  {
    "name": "Miriam",
    "goodBrigade": "White",
    "evilBrigade": "Pale Green",
    "primaryGood": 13,
    "otherGood": 11,
    "neutral": 5,
    "primaryEvil": 10,
    "otherEvil": 11,
    "totalCards": 50,
    "paragonTitle": "Paragon of Praise",
    "ability": "If your Exodus character wins a battle, discard the top 2 cards of each opponent's deck. While you are attacking, restrict each player whose deck is empty from blocking and playing evil Dominants.",
    "reference": "Exodus 15:20-21",
    "verse": "Miriam the prophetess, Aaron’s sister, took the tambourine in her hand, and all the women went out after her with tambourines and with dancing. And Miriam answered them, “Sing to the Lord, for He is highly exalted; The horse and his rider He has hurled into the sea.”"
  }
];

/**
 * Get Paragon by name
 */
export function getParagonByName(name: string): ParagonData | undefined {
  return PARAGONS.find(p => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get all Paragon names for dropdown
 */
export function getParagonNames(): string[] {
  return PARAGONS.map(p => p.name);
}

/**
 * Get Paragon image path
 */
export function getParagonImagePath(name: string): string {
  return `/paragons/${name.toLowerCase()}.png`;
}
