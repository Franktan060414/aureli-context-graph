export async function selectView(page, label) {
  await page.getByRole("combobox", { name: /^切换视图/ }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.getByRole("listbox", { name: "视图选择" }).waitFor({ state: "hidden" });
}
