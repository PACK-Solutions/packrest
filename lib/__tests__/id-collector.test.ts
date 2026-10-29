import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCollectedIds,
  collectedIdsFor,
  extractSeenItems,
  isCollectionPath,
  isIdField,
  itemLabel,
  loadSeenIds,
  pickerGroups,
  recordCreatedId,
  recordResponseIds,
  recordSeenIds,
} from "@/lib/id-collector";

const created = (id: string, label = "Créer un contrat") => ({
  apiId: "contract",
  operationId: "createContract",
  method: "POST",
  id,
  label,
});

const funds = {
  apiId: "product",
  operationId: "listFunds",
  operationLabel: "Lister les fonds",
};

beforeEach(() => clearCollectedIds());

describe("recordCreatedId", () => {
  it("keeps the 5 most recent per API, newest first", () => {
    for (let i = 1; i <= 6; i++) recordCreatedId(created(`c-${i}`));
    expect(collectedIdsFor("contract").map((e) => e.id)).toEqual([
      "c-6",
      "c-5",
      "c-4",
      "c-3",
      "c-2",
    ]);
  });

  it("skips an id equal to one of the request's path params", () => {
    recordCreatedId(created("c-1"));
    recordCreatedId(created("c-1", "Soumettre le contrat"), ["c-1"]);
    expect(collectedIdsFor("contract")).toHaveLength(1);
    expect(collectedIdsFor("contract")[0].label).toBe("Créer un contrat");
  });

  it("keeps the created resource's name", () => {
    recordCreatedId({ ...created("p-1"), name: "Martin Léa" });
    expect(collectedIdsFor("contract")[0].name).toBe("Martin Léa");
  });

  it("moves an already-collected id to the top, keeping its label", () => {
    recordCreatedId(created("c-1"));
    recordCreatedId(created("c-2"));
    recordCreatedId({ ...created("c-1", "Mettre à jour"), operationId: "update" });
    const list = collectedIdsFor("contract");
    expect(list.map((e) => e.id)).toEqual(["c-1", "c-2"]);
    expect(list[0]).toMatchObject({
      label: "Créer un contrat",
      operationId: "createContract",
    });
  });
});

describe("recordResponseIds", () => {
  const source = {
    apiId: "person",
    operationId: "createIndividual",
    method: "POST",
    path: "/individuals",
    operationLabel: "Créer une personne",
    pathParamValues: [],
  };
  const person = { id: "p-1", first_name: "Léa", last_name: "Martin" };

  it("collects a created resource with its name and origin", () => {
    recordResponseIds({ ...source, origin: "parcours" }, { status: 201, body: person });
    expect(collectedIdsFor("person")[0]).toMatchObject({
      id: "p-1",
      label: "Créer une personne",
      name: "Martin Léa",
      origin: "parcours",
    });
  });

  it("ignores a failed or action POST", () => {
    recordResponseIds(source, { status: 422, body: person });
    recordResponseIds(
      { ...source, path: "/individuals/{person_id}/submit", pathParamValues: ["p-1"] },
      { status: 200, body: person },
    );
    expect(collectedIdsFor("person")).toEqual([]);
  });

  it("collects the items of a list GET only", () => {
    const list = { ...source, method: "GET", operationId: "listIndividuals" };
    recordResponseIds(list, { status: 200, body: [person] });
    recordResponseIds(
      { ...list, operationId: "getIndividual", path: "/individuals/{person_id}" },
      { status: 200, body: person },
    );
    expect(Object.keys(loadSeenIds())).toEqual(["person::listIndividuals"]);
  });
});

describe("isCollectionPath", () => {
  it("is true when the path ends in a static segment", () => {
    expect(isCollectionPath("/funds")).toBe(true);
    expect(isCollectionPath("/individuals/{person_id}/payment-methods")).toBe(true);
  });

  it("is false for a single-resource path", () => {
    expect(isCollectionPath("/contracts/{contract_id}")).toBe(false);
  });
});

describe("extractSeenItems", () => {
  it("reads a HAL `_embedded` collection, labelled by name", () => {
    const body = {
      _embedded: {
        funds: [
          { id: "f-1", name: "Fonds euro", isin: "FR0000000001" },
          { id: "f-2", isin: "FR0000000002" },
        ],
      },
      _links: { self: { href: "/funds" } },
    };
    expect(extractSeenItems(body)).toEqual([
      { id: "f-1", label: "Fonds euro" },
      { id: "f-2", label: "FR0000000002" },
    ]);
  });

  it("reads a root array", () => {
    expect(extractSeenItems([{ id: 7, code: "PM" }])).toEqual([
      { id: "7", label: "PM" },
    ]);
  });

  it("labels a person with their first and last name", () => {
    const body = {
      _embedded: { individuals: [{ id: "p-1", first_name: "Léa", last_name: "Martin" }] },
    };
    expect(extractSeenItems(body)).toEqual([{ id: "p-1", label: "Martin Léa" }]);
  });

  it("leaves the label out when nothing names the item, and skips items without an id", () => {
    const body = [{ id: "x-1", status: "DRAFT" }, { status: "DRAFT" }, "x-2"];
    const items = extractSeenItems(body);
    expect(items).toEqual([{ id: "x-1" }]);
    expect(items[0].label).toBeUndefined();
  });
});

describe("itemLabel", () => {
  it("names a created person « last_name first_name »", () => {
    expect(itemLabel({ id: "p-1", first_name: "Léa", last_name: "Martin" })).toBe(
      "Martin Léa",
    );
  });

  it("is undefined when nothing obvious names the resource", () => {
    expect(itemLabel({ id: "c-1", status: "DRAFT" })).toBeUndefined();
    expect(itemLabel([])).toBeUndefined();
  });
});

describe("extractSeenItems on a single resource", () => {
  it("ignores an object's own arrays", () => {
    const options = { compartments: [{ id: "k-1", name: "Euro" }] };
    expect(extractSeenItems(options)).toEqual([]);
  });
});

describe("recordSeenIds", () => {
  const ids = () => loadSeenIds()["product::listFunds"].map((e) => e.id);

  it("puts the latest response first and dedupes by id", () => {
    recordSeenIds(funds, [
      { id: "f-1", label: "A" },
      { id: "f-2", label: "B" },
    ]);
    recordSeenIds(funds, [
      { id: "f-3", label: "C" },
      { id: "f-1", label: "A2" },
    ]);
    expect(ids()).toEqual(["f-3", "f-1", "f-2"]);
    expect(loadSeenIds()["product::listFunds"][1].label).toBe("A2");
  });

  it("keeps the first 20 items per operation", () => {
    recordSeenIds(funds, [{ id: "old", label: "old" }]);
    recordSeenIds(
      funds,
      Array.from({ length: 25 }, (_, i) => ({ id: `f-${i}`, label: `F${i}` })),
    );
    expect(ids()).toHaveLength(20);
    expect(ids()[0]).toBe("f-0");
    expect(ids()).not.toContain("old");
  });

  it("replaces the operation's entries on request", () => {
    recordSeenIds(funds, [{ id: "f-1", label: "A" }]);
    recordSeenIds(funds, [{ id: "f-2", label: "B" }], { replace: true });
    expect(ids()).toEqual(["f-2"]);
  });

  it("is cleared with its API's created ids", () => {
    recordSeenIds(funds, [{ id: "f-1", label: "A" }]);
    recordSeenIds({ ...funds, apiId: "person", operationId: "listIndividuals" }, [
      { id: "p-1" },
    ]);
    clearCollectedIds("product");
    expect(Object.keys(loadSeenIds())).toEqual(["person::listIndividuals"]);
  });

  it("is cleared with the created ids", () => {
    recordSeenIds(funds, [{ id: "f-1", label: "A" }]);
    clearCollectedIds();
    expect(loadSeenIds()).toEqual({});
  });
});

describe("pickerGroups", () => {
  const products = {
    apiId: "product",
    operationId: "listProducts",
    operationLabel: "List Products",
  };
  const sources = (name?: string) =>
    pickerGroups(name).map((g) => `${g.apiId} ${g.source}`);

  beforeEach(() => {
    recordCreatedId({
      apiId: "person",
      operationId: "createIndividual",
      method: "POST",
      id: "p-1",
      label: "Créer une personne",
      name: "Martin Léa",
      origin: "parcours",
    });
    recordSeenIds(products, [{ id: "pr-1", label: "Épargne" }]);
    recordSeenIds(funds, [{ id: "f-1", label: "Fonds euro" }]);
  });

  it("offers only the products on product_id", () => {
    expect(sources("product_id")).toEqual(["product Vus · List Products"]);
  });

  it("offers everything but the products elsewhere", () => {
    expect(sources("subscriber_id")).toEqual([
      "person Créés · Créer une personne",
      "product Vus · Lister les fonds",
    ]);
  });

  it("carries the created resource's name and origin", () => {
    expect(pickerGroups("subscriber_id")[0].entries[0]).toMatchObject({
      id: "p-1",
      label: "Martin Léa",
      origin: "parcours",
    });
  });
});

describe("isIdField", () => {
  it("holds for a uuid format", () => {
    expect(isIdField("contract", { type: "string", format: "uuid" })).toBe(true);
  });

  it("holds for a `_id` name without a format", () => {
    expect(isIdField("payment_method_id", { type: "string" })).toBe(true);
  });

  it("does not hold otherwise", () => {
    expect(isIdField("first_name", { type: "string" })).toBe(false);
    expect(isIdField(undefined, { type: "string", format: "date" })).toBe(false);
  });
});
