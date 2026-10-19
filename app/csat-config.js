(function (root) {
  const choices = (prefix, labels) => labels.map((label, i) => ({ id:`${prefix}-${i + 1}`, label }));
  const config = {
    version:"phone-videography-v1", title:"PHONE VIDEOGRAPHY", subtitle:"Post-Evaluation Survey",
    instruction:"Rate the following items, where 5 = highest and 1 = lowest. Please also share your comments or suggestions.",
    divisions:choices("division", ["LG Division", "OJ Division", "BC Division", "OMF Division", "International Sales", "EBroker Sales"]),
    branches:{
      "division-1":{ title:"LG DIVISION", subtitle:"Sales Directors", question:"Sales Director", choices:choices("lg", ["Henry Ignacio", "Emilia Paula Abad", "Rolando Cervantes", "Monica Tittel", "Jeff Cepillo", "Warren Rafal", "Marty Dames", "Leonila Fernandez", "Abigail Bernales", "Romel Belostrino"]) },
      "division-2":{ title:"OJ DIVISION", subtitle:"Sales Directors", question:"Sales Director", choices:choices("oj", ["Monaliza Adao", "Wally Cruz", "Jeff Bote", "Brian Cervantes", "Wally Cruz", "Jocelyn Costillas", "Maria Luisa Corral"]) },
      "division-3":{ title:"BC DIVISION", subtitle:"Sales Directors", question:"Sales Director", choices:choices("bc", ["Norma Hombrebuano", "Ron Meynard Aldover", "Andrew Cabungcal", "Angelo Villegas", "Walter Balderas"]) },
      "division-5":{ title:"INTERNATIONAL SALES", subtitle:"Sales Directors", question:"Sales Director", choices:choices("intl", ["Jacklord Pena"]) },
      "division-6":{ title:"EBroker Sales", subtitle:"Broker Officer", question:"Broker Officer", choices:choices("broker", ["Eden Namora", "Lian Tambis"]) }
    },
    ratings:[
      { id:"program", title:"How satisfied are you with the program?" },
      { id:"learning", title:"How satisfied are you with the learning session provided?" },
      { id:"venue", title:"How satisfied are you with the event venue?" },
      { id:"food", title:"How satisfied are you with the food provided?" },
      { id:"speaker", title:"How satisfied are you with the speaker?" }
    ],
    lowLabel:"Not at all Satisfied", highLabel:"Extremely Satisfied",
    texts:[{ id:"favorite", title:"What is your most favorite part of the event/program?" }, { id:"comments", title:"Comments/suggestions with the event" }]
  };
  if (typeof module === "object" && module.exports) module.exports = config;
  else root.CsatConfig = config;
})(typeof window === "object" ? window : globalThis);
