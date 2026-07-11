import type { Course, Product, RegistrationForm } from "@prisma/client";
import { upsertCourseAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SelectField, SubmitButton, TextArea } from "@/components/ui";

export function CourseForm({
  course,
  forms,
  products,
}: {
  course?: Course;
  forms: RegistrationForm[];
  products: Product[];
}) {
  return (
    <Card>
      <form action={upsertCourseAction} className="grid gap-5">
        <CsrfField />
        {course ? <input type="hidden" name="id" value={course.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="課程／活動名稱" name="title" required defaultValue={course?.title} />
          <Field label="公開 Slug" name="slug" required defaultValue={course?.slug} />
          <SelectField label="報名表" name="registrationFormId" defaultValue={course?.registrationFormId}>
            <option value="">尚未綁定</option>
            {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
          </SelectField>
          <SelectField label="主要商品" name="defaultProductId" defaultValue={course?.defaultProductId}>
            <option value="">不顯示商品 CTA</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </SelectField>
          <Field label="封面圖片 URL" name="coverImageUrl" type="url" defaultValue={course?.coverImageUrl} placeholder="https://..." />
          <SelectField label="狀態" name="status" defaultValue={course?.status ?? "draft"}>
            <option value="draft">草稿</option>
            <option value="published">發布</option>
            <option value="archived">封存</option>
          </SelectField>
        </div>
        <TextArea label="銷講頁說明" name="description" rows={5} defaultValue={course?.description} />
        <div className="flex justify-end"><SubmitButton>{course ? "更新課程" : "建立草稿"}</SubmitButton></div>
      </form>
    </Card>
  );
}
