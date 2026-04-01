const PARK_MINISTRY_SMARTSUITE = {
  solutionId: "6904e7fb69384c956ff7afc7",
  applications: {
    buying: {
      applicationId: "6904e82ac51862fbb5108850",
      tableId: "6904e84a27b2fb66b110892e",
      fields: {
        eventDate: "sbfd3ad917",
        eventTime: "s171db70d9",
        provider: "se0faafd98",
        performerName: "s8ca99e8cd",
        venueName: "sded73199c",
        parkingLocation: "s9e0097295",
        buyCost: "s73d1f14c7",
        sellPrice: "s376ebbc97",
        platformListedOn: "s6539d6d21",
        parkingLocationId: "s74aed3b66",
        cityState: "s914a271f4",
        reservationUrl: "s884fdb736",
        reservationId: "sdb959ef08",
        live: "sf2896747f",
        eventId: "s1ded883e9",
      },
    },
    locations: {
      applicationId: "6904e858d0b388387f0fa49e",
      tableId: "6904e858d0b388387f0fa49e",
      fields: {
        title: "title",
        venueName: "s93a499ca0",
        providerName: "sa938cb8ba",
        locationStatus: "status",
        parkingLocationId: "autonumber",
        buyCost: "seadbead5d",
        sellPrice: "sgfp8sul",
        distanceFromVenue: "s06ff46552",
        distanceUnit: "se71448816",
      },
    },
    inventory: {
      applicationId: "6904e82ac51862fbb5108850",
      reviewApplicationId: "690dffc401ee8baa3ac79394",
      fields: {
        eventDate: "s5493bb7f9",
        eventTime: "s2f8617368",
        performerName: "s29a68a847",
        venueName: "s4908bd369",
        parkingLocation: "s20f00004a",
        buyCost: "s537dd8bfd",
        sellPrice: "s376ebbc97",
        totalPayout: "s385642340",
        profit: "s9709b18f9",
        sold: "s3f66052d0",
        externalOrderNumber: "sd063a3ed0",
        clientFullName: "s7c232ef55",
        clientEmail: "smkhmtva",
        fullEventInfo: "s8bf7640e0",
        firstCreated: "first_created",
        fulfilled: "s2e273a461",
        requestForSolution: "s2795b4f06",
        pdf: "s405074e91",
        provider: "",
        invoiceId: "",
        requestCommentDetail: "s404f59f33",
        resolutionOverride: "s75d8386b1",
        pdfChecker: "s1ead027dd",
        reservationId: "s5b5279bb5",
      },
    },
  },
};

const BUYING_SMARTSUITE = {
  applicationId: PARK_MINISTRY_SMARTSUITE.applications.buying.applicationId,
  buyingTableId: PARK_MINISTRY_SMARTSUITE.applications.buying.tableId,
  fields: PARK_MINISTRY_SMARTSUITE.applications.buying.fields,
};

const INVENTORY_SMARTSUITE = {
  applicationId: PARK_MINISTRY_SMARTSUITE.applications.inventory.applicationId,
  reviewApplicationId: PARK_MINISTRY_SMARTSUITE.applications.inventory.reviewApplicationId,
  fields: PARK_MINISTRY_SMARTSUITE.applications.inventory.fields,
};

const LOCATIONS_SMARTSUITE = {
  applicationId: PARK_MINISTRY_SMARTSUITE.applications.locations.applicationId,
  tableId: PARK_MINISTRY_SMARTSUITE.applications.locations.tableId,
  fields: PARK_MINISTRY_SMARTSUITE.applications.locations.fields,
};

module.exports = {
  PARK_MINISTRY_SMARTSUITE,
  BUYING_SMARTSUITE,
  SMARTSUITE: BUYING_SMARTSUITE,
  INVENTORY_SMARTSUITE,
  LOCATIONS_SMARTSUITE,
};
