# Cesiones de terceros

Este fichero recoge los permisos que personas ajenas al proyecto han dado por escrito
para que Yoru Reader use código suyo. No es documentación de cortesía: es lo único que
sostiene la presencia de ese código aquí, porque la licencia pública de sus repositorios
no lo permitiría por sí sola. Si alguien duda dentro de un año de dónde salió una parte
del lector, la respuesta tiene que estar en este fichero.

Nada se porta antes de quedar anotado aquí.

---

## Nanahoshi — Natsume (Natsume-197)

- **Repositorio**: <https://github.com/Natsume-197/Nanahoshi>
- **Autor**: Natsume (`Natsume-197` en GitHub, `natsume` en Discord)
- **Medio de la cesión**: mensaje de Discord, marca de hora 13:33. zams envió la captura
  el 7 de noviembre de 2026.
- **Texto literal del permiso**:

  > yo natsume le cedo el codigo bajo gpl a zams de yoru ya que es mi mejor amigo

- **Prueba**: la captura original la guarda zams. Queda pendiente de añadirla al
  repositorio, en `docs/permisos/natsume-cesion-gpl.png`, cuando él lo autorice: es un
  mensaje privado de otra persona y publicarlo es decisión suya, no nuestra.

### Qué cubre y qué no

La licencia que Natsume tiene puesta en su repositorio **sigue siendo PolyForm Shield
1.0.0**, que no permite sublicenciar y por tanto es incompatible con la GPL de Yoru. Esta
cesión no cambia eso: es un permiso aparte, personal, que Natsume da **a zams y para Yoru
Reader**, liberando su código bajo GPL para este uso. El proyecto de Natsume no queda
relicenciado, y nadie más puede ampararse en este permiso para copiar Nanahoshi.

Cubre **solo el código escrito por Natsume**. Nanahoshi incorpora trabajo de terceros
—bibliotecas, tipografías, iconos, datos— que no es suyo y que él no puede ceder. Nada de
eso entra aquí: cuando una parte que haga falta dependa de algo de un tercero, se para y
se busca otra salida, no se copia.

### Versión de la GPL

El permiso dice «bajo gpl» sin número de versión. Yoru Reader es **GPL-2.0-or-later**, así
que el permiso encaja se refiera a la 2 o a la 3: si fuera GPL-3, la cláusula «or later»
de Yoru permite que el conjunto se distribuya bajo la 3. No hay que decidir nada ahora,
pero si alguna vez se quisiera fijar el proyecto en GPL-2 a secas, habría que preguntarle
a Natsume cuál tenía en mente.

### Cómo se marca el código portado

Cada fichero que traiga trabajo de Nanahoshi lleva en su cabecera una nota que lo diga:
de dónde viene, de quién es y que está aquí por esta cesión. Lo que se porte se adapta a
los tokens y a la forma de Yoru, o se reescribe; no se pega tal cual.

```
/*
  Portado de Nanahoshi (https://github.com/Natsume-197/Nanahoshi), de Natsume.
  Usado con su permiso expreso bajo GPL; ver THIRD-PARTY-GRANTS.md.
*/
```
