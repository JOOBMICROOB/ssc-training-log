import { getShopProducts, setShopProducts, getDashboardModel, updateFromCoach } from "../../lib/data/athleteData";
import { getClients } from "./coachData";

/**
 * Dashboard → Shop. Coach-managed catalogue (shared to every athlete's shop) +
 * the orders athletes have sent in. Editing a product here changes what the
 * athlete sees; submitted orders come straight from the athlete app.
 */

type Product = ReturnType<typeof getShopProducts>[number];

export function ShopView({ coachId }: { coachId: string }) {
  const products = getShopProducts();
  const clients = getClients(coachId);

  // Pull each athlete's last submitted order.
  const orders = clients
    .map((c) => ({ client: c, order: getDashboardModel(c.athleteId).shopSubmitted }))
    .filter((o) => o.order && Object.keys(o.order.cart).length > 0);

  const update = (id: string, patch: Partial<Product>) => setShopProducts(products.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string) => { if (confirm("Remove this product from the shop?")) setShopProducts(products.filter((p) => p.id !== id)); };
  const add = () => setShopProducts([...products, { id: `prod_${Date.now().toString(36)}`, name: "NEW PRODUCT", desc: "", price: 0, sized: true, images: [] }]);
  const priceOf = (id: string) => products.find((p) => p.id === id)?.price ?? 0;
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Team Shop</h1>
          <p className="cc-sub">Prices, photos and text here are what the athletes see — edit in place and the shop follows. Orders come in from the athlete app.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Products" v={products.length} />
          <Stat k="Open orders" v={orders.length} />
          <Stat k="Order total €" v={orders.reduce((s, o) => s + Object.entries(o.order!.cart).reduce((a, [id, q]) => a + priceOf(id) * q, 0), 0)} />
        </div>
      </div>

      <div className="cc-plan-grid" style={{ marginTop: 22 }}>
        {/* catalogue */}
        <div>
          {products.map((p) => (
            <div key={p.id} className="cc-panel cc-corner" style={{ position: "relative", marginBottom: 12 }}>
              <i />
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flex: "0 0 64px", height: 64, borderRadius: 10, overflow: "hidden", background: "var(--surface)", display: "grid", placeItems: "center" }}>
                  {p.images?.[0] ? <img src={p.images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span className="cc-cell-s">no photo</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input className="cc-db-search" defaultValue={p.name} onBlur={(e) => update(p.id, { name: e.target.value })} style={{ fontWeight: 600 }} />
                  <input className="cc-db-search" style={{ marginTop: 6 }} placeholder="Description" defaultValue={p.desc} onBlur={(e) => update(p.id, { desc: e.target.value })} />
                  <input className="cc-db-search" style={{ marginTop: 6 }} placeholder="Photo URL (/assets/… or https://)" defaultValue={p.images?.[0] ?? ""} onBlur={(e) => update(p.id, { images: e.target.value ? [e.target.value] : [] })} />
                  <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <label className="cc-side-k" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>€
                      <input className="cc-in" style={{ width: 70 }} type="number" defaultValue={p.price} onBlur={(e) => update(p.id, { price: Number(e.target.value) })} />
                    </label>
                    <label className="cc-side-k" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" defaultChecked={p.sized} onChange={(e) => update(p.id, { sized: e.target.checked })} />sized
                    </label>
                    <label className="cc-side-k" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" defaultChecked={!!p.freeEligible} onChange={(e) => update(p.id, { freeEligible: e.target.checked })} />1st free
                    </label>
                    <button className="cc-wk-del" style={{ marginLeft: "auto" }} title="Remove" onClick={() => remove(p.id)}>×</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button className="cc-dash-add" onClick={add}>+ Add a product</button>
        </div>

        {/* orders */}
        <aside style={{ alignSelf: "start" }}>
          <div className="cc-side-k" style={{ marginBottom: 10 }}>Orders</div>
          {orders.length === 0 && <div className="cc-cell-s">No orders yet.</div>}
          {orders.map(({ client, order }) => {
            const total = Object.entries(order!.cart).reduce((a, [id, q]) => a + priceOf(id) * q, 0);
            return (
              <div key={client.athleteId} className="cc-panel cc-corner" style={{ position: "relative", marginBottom: 10 }}>
                <i />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ font: "600 14px/1.1 var(--font-heading)", color: "var(--navy)" }}>{client.name}</div>
                  <div className="cc-cell-s">size {order!.size}</div>
                </div>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {Object.entries(order!.cart).map(([id, q]) => (
                    <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                      <span style={{ color: "var(--navy)" }}>{nameOf(id)} ×{q}</span>
                      <span className="cc-cell-s">€{priceOf(id) * q}</span>
                    </div>
                  ))}
                </div>
                {order!.note && <div className="cc-cell-s" style={{ marginTop: 6, fontStyle: "italic" }}>{order!.note}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <span style={{ font: "600 15px/1 var(--font-heading)", color: "var(--navy)" }}>€{total}</span>
                  <button className="cc-mini" onClick={() => updateFromCoach(client.athleteId, { shopSubmitted: undefined })}>Mark done</button>
                </div>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="cc-stat cc-corner" style={{ position: "relative" }}>
      <i />
      <div className="cc-stat-k">{k}</div>
      <div className="cc-stat-v">{v}</div>
    </div>
  );
}
