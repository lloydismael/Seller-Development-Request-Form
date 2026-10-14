/*
 * Seller Development Request Form – question & branching configuration.
 * Source: Microsoft Forms definition (tableId T9VQ63TXL4AXTINZHMS676587P).
 *
 * type:  "text" | "choice" (single) | "multi" (checkbox) | "date"
 * field: structured booking field used by the admin portal / availability checks
 * Routing: choice.goto -> jump to question id; question.next -> default next.
 */
const FORM_CONFIG = {
  title: "Seller Development Request Form",
  start: "name",
  questions: {
    name: { title: "Name of Requestor", type: "text", required: true, field: "requestor", next: "division" },

    division: {
      title: "Sales Division", type: "choice", required: true, field: "division",
      choices: [
        { label: "LG Division", goto: "sd_lg" },
        { label: "OJ Division", goto: "sd_oj" },
        { label: "BC Division", goto: "sd_bc" },
        { label: "OMF Division", goto: "sd_omf" },
        { label: "EBroker Sales", goto: "bo_ebroker" },
        { label: "International Sales", goto: "sd_intl" },
        { label: "Regional Sales - Davao", goto: "sd_davao" },
        { label: "Regional Sales - Cebu", goto: "sd_cebu" },
        { label: "Property Advisors Unit", goto: "bh_pau" }
      ]
    },

    sd_lg: {
      title: "LG Division - Sales Director", type: "choice", required: true, field: "director", next: "category",
      choices: [
        "Elinor Abigail P. Bernales (APB)", "Emilia Paula Abad (EPA)", "Henry R. Ignacio (HRI)",
        "Jeffrey M. Cepillo (JMC)", "Leonila R. Fernandez (LRF)", "Marty Aladdin B. Dames (MBD)",
        "Monica Marie C. Tittel (MCT)", "Rolando M. Cervantes (RMC)", "Romel H. Belostrino (RHB)",
        "Warren M. Rafal (WMR)"
      ]
    },
    sd_oj: {
      title: "OJ Division - Sales Director", type: "choice", required: true, field: "director", next: "category",
      choices: [
        "Jeffrey Paul C. Bote (JPB)", "Jocelyn A. Costillas (JAC)", "Joseph Brian E. Cervantes (BEC)",
        "Maria Luisa R. Corral (MLC)", "Monaliza A. Adao (MAA)", "Wally F. Cruz (WFC)",
        "Virgene P. Tangonan (VPT)"
      ]
    },
    sd_bc: {
      title: "BC Division - Sales Director", type: "choice", required: true, field: "director", next: "category",
      choices: ["Angelo Ruzen P. Villegas (APV)", "Marwen Anjo Cobey (MAC)", "Norma A. Hombrebuano (NAH)", "Walter V. Balderas (WVB)"]
    },
    sd_omf: {
      title: "OMF Division - Sales Director", type: "choice", required: true, field: "director", next: "category",
      choices: ["Angelo Ruzen P. Villegas (APV)", "Marwen Anjo Cobey (MAC)", "Norma A. Hombrebuano (NAH)", "Walter V. Balderas (WVB)"]
    },
    bo_ebroker: {
      title: "EBroker Sales - Broker Officer", type: "choice", required: true, field: "director", next: "category",
      choices: ["Edelina Namora", "Lily Ann Tambis"]
    },
    sd_intl: {
      title: "International Sales - Sales Director", type: "choice", required: true, field: "director", next: "category",
      choices: ["Jacklord R. Peña (APV)"]
    },
    sd_davao: {
      title: "Davao Regional Sales - Sales Director", type: "choice", required: true, field: "director", next: "category",
      choices: ["Angelo Ruzen P. Villegas (APV)", "Marwen Anjo Cobey (MAC)", "Norma A. Hombrebuano (NAH)", "Walter V. Balderas (WVB)"]
    },
    sd_cebu: {
      title: "Cebu Regional Sales - Sales Director", type: "choice", required: true, field: "director", next: "category",
      choices: ["Angelo Ruzen P. Villegas (APV)", "Marwen Anjo Cobey (MAC)", "Norma A. Hombrebuano (NAH)", "Walter V. Balderas (WVB)"]
    },
    bh_pau: {
      title: "PAU - Branch Head", type: "choice", required: true, field: "director", next: "category",
      choices: ["Divina Gracia D. Lorenzana", "Jeanette G. Nerona"]
    },

    category: {
      title: "Training Category", type: "choice", required: true, field: "category",
      choices: [
        { label: "Tech Talk Program (Technical Skills)", goto: "t_tech" },
        { label: "Sales Edge Program (Soft Skills)", goto: "t_edge" },
        { label: "Level Up (Leadership Training)", goto: "t_levelup" },
        { label: "Real Estate Market Trends", goto: "t_market" },
        { label: "Project Expertise Program (PEP)", goto: "project" },
        { label: "Sellers' Site Appreciation Tour (SSAT)", goto: "project" },
        { label: "WorkLink Program (Inter-Departmental Learning Session)", goto: "process" },
        { label: "Assembly Support", goto: "assembly" }
      ]
    },

    t_tech:    { title: "Tech Talk Topics", type: "choice", required: true, field: "topic", next: "date", choices: ["Meta Andromeda", "Phone Videography"] },
    t_edge:    { title: "Sales Edge Topics", type: "choice", required: true, field: "topic", next: "date", choices: ["High Impact Selling", "Prospecting Checklist"] },
    t_levelup: { title: "Level Up Topics", type: "choice", required: true, field: "topic", next: "date", choices: ["Productivity Hacks", "Leading through the Storm"] },
    t_market:  { title: "Real Estate Market News Topics", type: "multi", required: true, field: "topic", next: "date", choices: ["What's Next in the Philippine Real Estate Market"] },
    project:   { title: "Project in Focus", type: "multi", required: true, max: 3, field: "topic", next: "date", choices: ["Allegra Garden Place", "Prisma Residences", "Fortis Residences"] },
    process:   { title: "Process in Focus", type: "multi", required: true, max: 2, field: "topic", next: "date", choices: ["Credit Investigation Process", "Post-Construction Guidelines", "PMO Guidelines", "Sales Process"] },
    assembly:  { title: "Assembly", type: "choice", required: true, field: "topic", next: "date", choices: ["Sales Managers' Assembly", "Sales Directors' Assembly"] },

    date: { title: "Training Date", type: "date", required: true, field: "trainingDate", next: "facilitator" },
    facilitator: { title: "Training Facilitator", type: "choice", required: true, field: "facilitator", next: "time",
      choices: ["Arwee P. Cancino", "Cladine I. Francia", "Jomari Andre F. Yu"] },
    time: { title: "Time of Training", type: "choice", required: true, field: "time", next: "venue",
      choices: ["9:00 AM - 12:00 PM", "10:00 AM - 12:00 PM", "1:00 PM - 3:00 PM", "1:00 PM - 5:00 PM", "9:00 AM - 5:00 PM"] },
    venue: {
      title: "Training Venue", type: "choice", required: true, allowOther: true, field: "venue", next: "participants",
      choices: [
        "Sellers' Lounge, GF, DHCC, Bangkal, Makati",
        "Caseroom, 6F, DHCC, Bangkal, Makati",
        "Training Room 2, 6F, DHCC, Bangkal, Makati",
        "HR Training Room 2, 2F, DHCC, Bangkal, Makati",
        "Board Room, 4F, DHCC, Bangkal, Makati",
        "Multi-Purpose Court, 6F, DHCC, Bangkal, Makati",
        "Valeron Satellite Office, Pasig City",
        "Altana Hall, Oak Harbor Residences, Paranaque City",
        "Marella deck, Oak Harbor Residences, Paranaque City",
        "Function Hall, RD, Kiran, Prisma Residences, Pasig City",
        "EBroker Sales Conference Room, GF, DHCC, Bangkal, Makati",
        "Online via Zoom Meeting",
        "Online via Microsoft Teams"
      ]
    },
    participants: { title: "Expected Number of Participants", type: "number", required: true, field: "participants", next: "recommendations" },
    recommendations: { title: "Request or Recommendations for the Training", type: "textarea", required: true, field: "recommendations" }
  }
};
if (typeof module === "object" && module.exports) module.exports = FORM_CONFIG;
if (typeof window === "object") window.FORM_CONFIG = FORM_CONFIG;
