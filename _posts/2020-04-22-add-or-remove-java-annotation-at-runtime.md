---
title: Add or remove Java annotation at runtime
date: 2020-04-22 20:01:04 +0800
categories: java
---

### Preface

Java is a language whose source files are compiled to bytecode. Unlike C/C++, we
cannot use preprocessing directive such as `#ifdef` syntactically. Suppose there is
such a case that normally a Java application runs with an annotation, but when
it's launched with some environment variable, then that annotation shouldn't be
defined (should be removed). For example:

```java
@Entity
public class Foo {

  @Id
  // If application is launched with Role=replica, we don't want the below line.
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;
}
```

So how exactly do we solve the above issue?

Basically, there are two ways. One way is to use a preprocessing step. We can use
`sed -i -e '/PATTERN/d' YOUR_FILE.java` to pre-process when building a jar
package. This is especially useful when we use docker to build with different
options. Another way is to add/remove the annotation dynamically at runtime. For
this purpose, we need to import two dependencies: [Javasist][javasist] and [Byte Buddy][bytebuddy].

We will use [Javasist][javasist] to modify and generate bytecodes, and [Byte
Buddy](bytebuddy) as instrumentation agent to retransform class. We will use
Spring Cloud to build a demo project and add some tests. The demo project can be
found [here][demo].

**Tip:** For more information about Java instrumentation, please visit
[here](https://docs.oracle.com/javase/8/docs/api/java/lang/instrument/package-summary.html).
{: .notice--info}

### Add annotation to a Java class field

Here is the core part of code snippets that add annotation to a Java class
field:

```java
public class JavasistUtils {

    public static void addAnnotationToField(Class<?> clazz, String fieldName, Class<?> annotationClass,
                                            BiConsumer<Annotation, ConstPool> initAnnotation) {
        ClassPool pool = ClassPool.getDefault();
        CtClass ctClass;
        try {
            ctClass = pool.getCtClass(clazz.getName());
            if (ctClass.isFrozen()) {
                ctClass.defrost();
            }
            CtField ctField = ctClass.getDeclaredField(fieldName);
            ConstPool constPool = ctClass.getClassFile().getConstPool();

            Annotation annotation = new Annotation(annotationClass.getName(), constPool);
            if (initAnnotation != null) {
                initAnnotation.accept(annotation, constPool);
            }

            AnnotationsAttribute attr = getAnnotationsAttributeFromField(ctField);
            if (attr == null) {
                attr = new AnnotationsAttribute(constPool, AnnotationsAttribute.visibleTag);
                ctField.getFieldInfo().addAttribute(attr);
            }
            attr.addAnnotation(annotation);

            retransformClass(clazz, ctClass.toBytecode());
        } catch (NotFoundException | IOException | CannotCompileException e) {
            e.printStackTrace();
        }
    }
}
```

### Remove annotation from a Java class field

Here is the core part of code snippets that remove annotation from a Java class
field:

```java
public class JavasistUtils {

    public static void removeAnnotationFromField(Class<?> clazz, String fieldName, Class<?> annotationClass) {
        ClassPool pool = ClassPool.getDefault();
        CtClass ctClass;
        try {
            ctClass = pool.getCtClass(clazz.getName());
            if (ctClass.isFrozen()) {
                ctClass.defrost();
            }
            CtField ctField = ctClass.getDeclaredField(fieldName);

            AnnotationsAttribute attr = getAnnotationsAttributeFromField(ctField);
            if (attr != null) {
                attr.removeAnnotation(annotationClass.getName());
            }

            retransformClass(clazz, ctClass.toBytecode());
        } catch (NotFoundException | IOException | CannotCompileException e) {
            e.printStackTrace();
        }
    }
}
```

### Test it out

First, we add two classes: Base and Book.

```java
@MappedSuperclass
public class Base {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }
}
```

```java
@Entity
public class Book extends Base {

    private String name;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

Then let's add unit tests to test if we can remove an annotation successfully.

```java
@ExtendWith(Extension.class)
@DataJpaTest
@TestExecutionListeners(
    listeners = DirtiesContextBeforeAndAfterClassTestExecutionListener.class,
    mergeMode = MergeMode.MERGE_WITH_DEFAULTS
)
public class JavasistUtilsTests {

    @Autowired
    private BookRepository bookRepository;

    @Test
    void testExceptionThrownWhenIdNotSpecified() {
        JpaSystemException exception = assertThrows(JpaSystemException.class, () -> {
            Book book = new Book();
            book.setName("Learn Spring");
            bookRepository.saveAndFlush(book);
        });

        assertTrue(exception.getMessage().startsWith("ids for this class must be manually assigned before calling save()"));
    }

    @Test
    void testOKWhenIdSpecified() {
        Book book = new Book();
        book.setId(1L);
        book.setName("Learn Spring");
        bookRepository.saveAndFlush(book);

        Book b = bookRepository.findById(1L).get();
        assertTrue(b.getName().equals("Learn Spring"));
    }

    public static class Extension implements BeforeAllCallback, AfterAllCallback {

        @Override
        public void beforeAll(ExtensionContext arg0) throws Exception {
            JavasistUtils.removeAnnotationFromField(Base.class, "id", GeneratedValue.class);
        }

        @Override
        public void afterAll(ExtensionContext arg0) throws Exception {
            JavasistUtils.addAnnotationToField(Base.class, "id", GeneratedValue.class, (annotation, constPool) -> {
                EnumMemberValue memberValue = new EnumMemberValue(constPool);
                memberValue.setType(GenerationType.class.getName());
                memberValue.setValue(GenerationType.IDENTITY.name());
                annotation.addMemberValue("strategy", memberValue);
            });
        }
    }
}
```

### Gotchas

Note the above `Extension` class. `Extension#beforeAll` will be invoked before
any test in `JavasistUtilsTests` runs. `Extension#afterAll` will be invoked
after all tests in `JavasistUtilsTests` run. So it means before any test in
`JavaJavasistUtilsTests` runs, we remove annotation `@GeneratedValue` from
`Base#id` field. If we don't specify an id value, then invoking
`BookRepository#saveAndFlush` will throw an exception that says "ids must be
manually assigned". When all tests in `JavaJavasistUtilsTests` finish, we add
that annotation back so that other test classes can run normally.

Another gotcha is we add a custom class
`DirtiesContextBeforeAndAfterClassTestExecutionListener.class` as test execution
listener. We need to ensure the spring application context is marked as dirty
both BEFORE and AFTER class to have JPA entity classes normally parsed in all
test classes. We cannot use `@DirtiesContext` here, because it only mark context
as dirty either BEFORE or AFTER. For more information about this gotcha, please
visit the stackoverflow [anwser](https://stackoverflow.com/a/39292587).

### Source codes

The demo project with full source codes is at [here][demo].

[javasist]: https://www.javassist.org/
[bytebuddy]: https://bytebuddy.net/#/
[demo]: https://github.com/uzxmx/javasist-demo
